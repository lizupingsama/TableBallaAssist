"""Change an APK's manifest identity without changing code or resource IDs.

The layouts follow Android ResourceTypes.h. XML string indices are retained;
new attribute values are appended to its existing UTF-8 or UTF-16 string pool.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import re
import struct


ANDROID = "http://schemas.android.com/apk/res/android"
NONE = 0xFFFFFFFF
STRING = 3
_PACKAGE = re.compile(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+")
_CLASSES = {
    "application": ("name", "backupAgent", "manageSpaceActivity", "appComponentFactory", "zygotePreloadName"),
    "activity": ("name", "parentActivityName"),
    "activity-alias": ("name", "targetActivity", "parentActivityName"),
    "service": ("name",), "receiver": ("name",), "provider": ("name",),
    "instrumentation": ("name",),
}


def _package(value: str) -> str:
    if not isinstance(value, str) or not _PACKAGE.fullmatch(value):
        raise ValueError("Expected a dot-separated Android package name")
    return value


def _u32(data: bytes | bytearray, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _chunks(content: bytes, start: int, end: int):
    offset = start
    while offset < end:
        if offset + 8 > end:
            raise ValueError("Truncated resource chunk header")
        kind, header, size = struct.unpack_from("<HHI", content, offset)
        if header < 8 or size < header or offset + size > end or size % 4:
            raise ValueError("Invalid resource chunk bounds")
        yield offset, kind, header, size
        offset += size
    if offset != end:
        raise ValueError("Resource chunks do not cover their parent")


def _length8(data: bytes, offset: int) -> tuple[int, int]:
    value = data[offset]
    return (((value & 0x7F) << 8) | data[offset + 1], offset + 2) if value & 0x80 else (value, offset + 1)


def _length16(data: bytes, offset: int) -> tuple[int, int]:
    value = struct.unpack_from("<H", data, offset)[0]
    return (((value & 0x7FFF) << 16) | struct.unpack_from("<H", data, offset + 2)[0], offset + 4) if value & 0x8000 else (value, offset + 2)


def _encode_length8(value: int) -> bytes:
    if value > 0x7FFF:
        raise ValueError("UTF-8 string pool entry is too long")
    return bytes([0x80 | (value >> 8), value & 0xFF]) if value > 0x7F else bytes([value])


def _encode_length16(value: int) -> bytes:
    return struct.pack("<HH", 0x8000 | (value >> 16), value & 0xFFFF) if value > 0x7FFF else struct.pack("<H", value)


class _StringPool:
    def __init__(self, raw: bytes):
        self.raw = raw
        kind, self.header_size, size = struct.unpack_from("<HHI", raw)
        if kind != 1 or self.header_size < 28 or size != len(raw):
            raise ValueError("Invalid XML string pool")
        count, self.style_count, self.flags, self.strings_start, self.styles_start = struct.unpack_from("<IIIII", raw, 8)
        offsets_end = self.header_size + 4 * (count + self.style_count)
        string_end = self.styles_start or len(raw)
        if not offsets_end <= self.strings_start <= string_end <= len(raw):
            raise ValueError("Invalid string pool offsets")
        self.offsets = list(struct.unpack_from("<" + "I" * count, raw, self.header_size))
        style_at = self.header_size + 4 * count
        self.style_offsets = raw[style_at:offsets_end]
        self.gap = raw[offsets_end:self.strings_start]
        self.string_data = raw[self.strings_start:string_end]
        self.style_data = raw[string_end:] if self.styles_start else b""
        self.original_count = count
        self.strings = []
        self.added = []
        for relative in self.offsets:
            if relative >= len(self.string_data):
                raise ValueError("String index is outside the string pool")
            if self.flags & 0x100:
                units, at = _length8(self.string_data, relative)
                length, at = _length8(self.string_data, at)
                encoded = self.string_data[at:at + length]
                if len(encoded) != length or self.string_data[at + length:at + length + 1] != b"\0":
                    raise ValueError("Truncated UTF-8 string pool entry")
                value = encoded.decode("utf-8", "surrogatepass")
            else:
                units, at = _length16(self.string_data, relative)
                encoded = self.string_data[at:at + units * 2]
                if len(encoded) != units * 2 or self.string_data[at + units * 2:at + units * 2 + 2] != b"\0\0":
                    raise ValueError("Truncated UTF-16 string pool entry")
                value = encoded.decode("utf-16-le", "surrogatepass")
            if len(value.encode("utf-16-le", "surrogatepass")) // 2 != units:
                raise ValueError("String pool character length mismatch")
            self.strings.append(value)

    def get(self, index: int) -> str | None:
        if index == NONE:
            return None
        if index >= len(self.strings):
            raise ValueError("Invalid XML string index")
        return self.strings[index]

    def add(self, value: str, *, unique: bool = False) -> int:
        if not unique and value in self.strings:
            return self.strings.index(value)
        index = len(self.strings)
        self.strings.append(value)
        self.added.append(value)
        return index

    def encode(self) -> bytes:
        if not self.added:
            return self.raw
        data = bytearray(self.string_data)
        offsets = list(self.offsets)
        for value in self.added:
            offsets.append(len(data))
            utf16 = value.encode("utf-16-le", "surrogatepass")
            units = len(utf16) // 2
            if self.flags & 0x100:
                utf8 = value.encode("utf-8", "surrogatepass")
                data.extend(_encode_length8(units) + _encode_length8(len(utf8)) + utf8 + b"\0")
            else:
                data.extend(_encode_length16(units) + utf16 + b"\0\0")
        data.extend(b"\0" * (-len(data) % 4))
        offsets_raw = struct.pack("<" + "I" * len(offsets), *offsets)
        start = self.header_size + len(offsets_raw) + len(self.style_offsets) + len(self.gap)
        styles_start = start + len(data) if self.styles_start else 0
        header = bytearray(self.raw[:self.header_size])
        size = start + len(data) + len(self.style_data)
        struct.pack_into("<I", header, 4, size)
        # Appending values invalidates a sorted pool's SORTED flag.
        struct.pack_into("<IIIII", header, 8, len(offsets), self.style_count, self.flags & ~1, start, styles_start)
        return bytes(header) + offsets_raw + self.style_offsets + self.gap + data + self.style_data


@dataclass
class _Attribute:
    raw: bytearray
    pool: _StringPool

    @property
    def name(self):
        return self.pool.get(_u32(self.raw, 4))

    @property
    def namespace(self):
        return self.pool.get(_u32(self.raw, 0))

    @property
    def value(self):
        if self.raw[15] == STRING:
            return self.pool.get(_u32(self.raw, 16))
        if _u32(self.raw, 8) != NONE:
            return self.pool.get(_u32(self.raw, 8))
        return {"type": self.raw[15], "data": _u32(self.raw, 16)}

    def set(self, value: str):
        index = self.pool.add(value)
        struct.pack_into("<I", self.raw, 8, index)
        struct.pack_into("<HBBI", self.raw, 12, 8, 0, STRING, index)


@dataclass(eq=False)
class _Element:
    raw: bytes
    pool: _StringPool
    index: int
    parent: _Element | None = None
    children: list = field(default_factory=list)

    def __post_init__(self):
        _, self.header_size, _ = struct.unpack_from("<HHI", self.raw)
        if self.header_size < 16 or len(self.raw) < self.header_size + 20:
            raise ValueError("Invalid XML start-element header")
        self.tag = self.pool.get(_u32(self.raw, self.header_size + 4))
        start, self.attr_size, count = struct.unpack_from("<HHH", self.raw, self.header_size + 8)
        self.attr_start = self.header_size + start
        if self.attr_size < 20 or self.attr_start < self.header_size + 20 or self.attr_start + count * self.attr_size > len(self.raw):
            raise ValueError("Invalid XML attribute bounds")
        self.attrs = [_Attribute(bytearray(self.raw[at:at + self.attr_size]), self.pool)
                      for at in range(self.attr_start, self.attr_start + count * self.attr_size, self.attr_size)]
        self.original_count = count
        self.special = list(struct.unpack_from("<HHH", self.raw, self.header_size + 14))

    def attr(self, name: str, namespace: str | None = ANDROID):
        return next((item for item in self.attrs if item.name == name and item.namespace == namespace), None)

    def value(self, name: str, namespace: str | None = ANDROID):
        attribute = self.attr(name, namespace)
        return attribute.value if attribute else None

    def encode(self) -> bytes:
        header = bytearray(self.raw[:self.attr_start])
        tail = self.raw[self.attr_start + self.original_count * self.attr_size:]
        size = len(header) + len(self.attrs) * self.attr_size + len(tail)
        struct.pack_into("<I", header, 4, size)
        struct.pack_into("<H", header, self.header_size + 12, len(self.attrs))
        struct.pack_into("<HHH", header, self.header_size + 14, *self.special)
        return bytes(header) + b"".join(bytes(item.raw) for item in self.attrs) + tail


class _Document:
    def __init__(self, content: bytes):
        if len(content) < 8:
            raise ValueError("Truncated binary XML")
        kind, self.header_size, size = struct.unpack_from("<HHI", content)
        if kind != 3 or self.header_size < 8 or size != len(content):
            raise ValueError("Expected a complete Android binary XML document")
        self.header = content[:self.header_size]
        self.chunks = []
        self.elements = []
        self.resource_ids = []
        self.resource_map_index = None
        self.pool = None
        stack = []
        for offset, kind, header, size in _chunks(content, self.header_size, len(content)):
            raw = content[offset:offset + size]
            index = len(self.chunks)
            if kind == 1:
                if self.pool:
                    raise ValueError("Multiple XML string pools are unsupported")
                self.pool = _StringPool(raw)
            elif kind == 0x180:
                if self.resource_map_index is not None or header != 8:
                    raise ValueError("Invalid XML resource map")
                self.resource_map_index = index
                self.resource_ids = list(struct.unpack_from("<" + "I" * ((size - 8) // 4), raw, 8))
            elif kind == 0x102:
                if self.pool is None:
                    raise ValueError("XML elements precede the string pool")
                node = _Element(raw, self.pool, index, stack[-1] if stack else None)
                if node.parent:
                    node.parent.children.append(node)
                self.elements.append(node)
                stack.append(node)
            elif kind == 0x103:
                if not stack or self.pool is None or self.pool.get(_u32(raw, header + 4)) != stack[-1].tag:
                    raise ValueError("Unbalanced XML element")
                stack.pop()
            self.chunks.append(raw)
        if self.pool is None or stack or not self.elements or self.elements[0].tag != "manifest":
            raise ValueError("Invalid manifest tree")
        self.root = self.elements[0]
        if not isinstance(self.root.value("package", None), str):
            raise ValueError("Manifest has no literal package name")
        self.package = _package(self.root.value("package", None))

    def set(self, node: _Element, name: str, value: str, namespace: str | None = ANDROID):
        attribute = node.attr(name, namespace)
        if attribute is None:
            if name != "label" or namespace != ANDROID:
                raise ValueError("Only a missing android:label may be inserted")
            resource_id = 0x01010001
            name_index = next((i for i, rid in enumerate(self.resource_ids)
                               if rid == resource_id and self.pool.get(i) == "label"), None)
            if name_index is None:
                name_index = self.pool.add("label", unique=True)
                self.resource_ids.extend([0] * (name_index + 1 - len(self.resource_ids)))
                self.resource_ids[name_index] = resource_id
            raw = bytearray(node.attr_size)
            struct.pack_into("<IIIHBBI", raw, 0, self.pool.add(ANDROID), name_index, NONE, 8, 0, STRING, 0)
            attribute = _Attribute(raw, self.pool)
            position = 0
            while position < len(node.attrs):
                other = _u32(node.attrs[position].raw, 4)
                other_id = self.resource_ids[other] if other < len(self.resource_ids) else 0
                if other_id and other_id > resource_id:
                    break
                position += 1
            node.attrs.insert(position, attribute)
            node.special = [index + 1 if index and index > position else index for index in node.special]
        attribute.set(value)

    def encode(self) -> bytes:
        chunks = list(self.chunks)
        pool_index = next(i for i, raw in enumerate(chunks) if struct.unpack_from("<H", raw)[0] == 1)
        chunks[pool_index] = self.pool.encode()
        for element in self.elements:
            chunks[element.index] = element.encode()
        if self.resource_ids:
            resource_map = struct.pack("<HHI", 0x180, 8, 8 + len(self.resource_ids) * 4)
            resource_map += struct.pack("<" + "I" * len(self.resource_ids), *self.resource_ids)
            if self.resource_map_index is None:
                chunks.insert(pool_index + 1, resource_map)
            else:
                chunks[self.resource_map_index] = resource_map
        header = bytearray(self.header)
        struct.pack_into("<I", header, 4, len(header) + sum(map(len, chunks)))
        return bytes(header) + b"".join(chunks)


def _resolve(package: str, value: str) -> str:
    if value.startswith("."):
        return package + value
    return package + "." + value if "." not in value else value


def _launchers(document: _Document) -> list[_Element]:
    result = []
    for node in document.elements:
        if node.tag not in ("activity", "activity-alias"):
            continue
        for intent in node.children:
            if intent.tag != "intent-filter":
                continue
            actions = {child.value("name") for child in intent.children if child.tag == "action"}
            categories = {child.value("name") for child in intent.children if child.tag == "category"}
            if "android.intent.action.MAIN" in actions and "android.intent.category.LAUNCHER" in categories:
                result.append(node)
                break
    return result


def inspect_manifest(content: bytes) -> dict:
    """Return JSON-compatible identity data, resolving component class names."""
    document = _Document(content)
    components, classes, declarations, uses, references, authorities = [], [], [], [], [], []
    launchers = _launchers(document)
    application = None
    for node in document.elements:
        fields = _CLASSES.get(node.tag, ())
        if fields:
            info = {"tag": node.tag}
            for name in fields:
                value = node.value(name)
                if isinstance(value, str) and value:
                    info[name] = _resolve(document.package, value)
                    classes.append({"tag": node.tag, "attribute": name, "class": info[name]})
            for name in ("label", "process", "taskAffinity", "permission", "readPermission", "writePermission"):
                if node.attr(name):
                    info[name] = node.value(name)
            if node.tag == "provider":
                value = node.value("authorities")
                if not isinstance(value, str) or not value:
                    raise ValueError("Provider has no literal authorities")
                info["authorities"] = value.split(";")
                authorities.extend(info["authorities"])
            info["launcher"] = node in launchers
            if node.tag == "application":
                application = info
            else:
                components.append(info)
        if node.tag in ("permission", "permission-group", "permission-tree"):
            declarations.append({"tag": node.tag, "name": node.value("name")})
        if node.tag.startswith("uses-permission"):
            uses.append(node.value("name"))
        for name in ("permission", "readPermission", "writePermission", "permissionGroup"):
            if node.attr(name):
                references.append({"tag": node.tag, "attribute": name, "value": node.value(name)})
    return {"package": document.package, "application": application, "components": components,
            "component_classes": classes, "launchers": [item for item in components if item["launcher"]],
            "provider_authorities": authorities, "permission_declarations": declarations,
            "permission_uses": uses, "permission_references": references,
            "metadata": [{"name": node.value("name"), "value": node.value("value"), "resource": node.value("resource")}
                         for node in document.elements if node.tag == "meta-data"],
            "shared_user_id": document.root.value("sharedUserId")}


def parse_manifest(content: bytes) -> dict:
    """Alias for the public, JSON-compatible manifest inspection API."""
    return inspect_manifest(content)


def clone_manifest(content: bytes, new_package: str, label: str) -> tuple[bytes, dict]:
    _package(new_package)
    if not isinstance(label, str) or not label or "\0" in label:
        raise ValueError("A nonempty application label without NUL is required")
    document = _Document(content)
    old = document.package
    if new_package == old:
        raise ValueError("The cloned package must differ from the original")
    if document.root.attr("sharedUserId"):
        raise ValueError("sharedUserId prevents a safely isolated clone")
    before = inspect_manifest(content)
    changes = []

    def change(node, name, value, namespace=ANDROID):
        previous = node.value(name, namespace)
        if previous != value:
            document.set(node, name, value, namespace)
            changes.append({"tag": node.tag, "attribute": name, "old": previous, "new": value})

    def namespace(value):
        if isinstance(value, str) and (value == old or value.startswith(old + ".") or value.startswith(old + ":")):
            return new_package + value[len(old):]
        return value

    change(document.root, "package", new_package, None)
    launchers = _launchers(document)
    app = next((node for node in document.elements if node.tag == "application"), None)
    if app is None:
        raise ValueError("Manifest has no application")
    app_name = app.value("name")
    game_prefix = _resolve(old, app_name).rsplit(".", 1)[0] + "." if isinstance(app_name, str) and app_name else old + "."
    label_nodes = [app]
    for node in document.elements:
        if node.tag in ("activity", "activity-alias"):
            name = node.value("name")
            if node in launchers or (isinstance(name, str) and _resolve(old, name).startswith(game_prefix)):
                label_nodes.append(node)
                label_nodes.extend(child for child in node.children if child.tag == "intent-filter" and child.attr("label"))
    for node in label_nodes:
        change(node, "label", label)
    for node in document.elements:
        for name in _CLASSES.get(node.tag, ()):
            value = node.value(name)
            if isinstance(value, str) and value and (value.startswith(".") or "." not in value):
                change(node, name, _resolve(old, value))
        if node.tag == "provider":
            value = node.value("authorities")
            if not isinstance(value, str) or not value:
                raise ValueError("Provider authorities must be literal strings")
            change(node, "authorities", ";".join(namespace(item) for item in value.split(";")))
        if node.tag in ("permission", "permission-tree", "permission-group") or node.tag.startswith("uses-permission"):
            value = node.value("name")
            if isinstance(value, str):
                change(node, "name", namespace(value))
        for name in ("permission", "readPermission", "writePermission", "permissionGroup", "taskAffinity", "process"):
            value = node.value(name)
            if isinstance(value, str):
                change(node, name, namespace(value))
        if node.tag == "instrumentation" and node.value("targetPackage") == old:
            change(node, "targetPackage", new_package)
    result = document.encode()
    after = inspect_manifest(result)
    overlap = set(before["provider_authorities"]) & set(after["provider_authorities"])
    if overlap:
        raise ValueError("Provider authorities still collide with the original: " + ", ".join(sorted(overlap)))
    if len(after["provider_authorities"]) != len(set(after["provider_authorities"])):
        raise ValueError("Cloned manifest has duplicate provider authorities")
    if before["component_classes"] != after["component_classes"]:
        raise ValueError("Component class identity changed unexpectedly")
    if before["metadata"] != after["metadata"]:
        raise ValueError("SDK metadata changed unexpectedly")
    return result, {"old_package": old, "new_package": new_package, "label": label,
                    "changed_attributes": changes, "appended_strings": len(document.pool.added),
                    "original_strings_preserved": True, "component_classes_preserved": True,
                    "sdk_metadata_preserved": True, "provider_authorities": after["provider_authorities"],
                    "provider_authorities_disjoint": True,
                    "permission_declarations": after["permission_declarations"],
                    "launchers": after["launchers"]}


def clone_resources(content: bytes, old_package: str, new_package: str) -> tuple[bytes, dict]:
    """Replace only the ResTable_package 128-char UTF-16 package-name field."""
    _package(old_package)
    _package(new_package)
    if old_package == new_package:
        raise ValueError("The cloned resource package must differ")
    encoded = new_package.encode("utf-16-le")
    if len(encoded) > 254:
        raise ValueError("Resource package name exceeds 127 UTF-16 code units")
    if len(content) < 12:
        raise ValueError("Truncated Android resource table")
    kind, header, size = struct.unpack_from("<HHI", content)
    if kind != 2 or header < 12 or size != len(content):
        raise ValueError("Expected a complete Android resource table")
    output = bytearray(content)
    modified = []
    package_count = 0
    for offset, kind, package_header, size in _chunks(content, header, len(content)):
        if kind != 0x200:
            continue
        package_count += 1
        if package_header < 284:
            raise ValueError("Truncated ResTable_package header")
        name = content[offset + 12:offset + 268].decode("utf-16-le").split("\0", 1)[0]
        if name == old_package:
            output[offset + 12:offset + 268] = encoded + b"\0" * (256 - len(encoded))
            modified.append({"chunk_offset": offset, "package_id": _u32(content, offset + 8),
                             "name_field_offset": offset + 12, "old_name": name, "new_name": new_package})
    if package_count != _u32(content, 8) or len(modified) != 1:
        raise ValueError("Expected exactly one matching original resource package")
    return bytes(output), {"packages": modified, "resource_ids_preserved": True,
                           "all_other_bytes_preserved": True, "bytes": len(output)}
