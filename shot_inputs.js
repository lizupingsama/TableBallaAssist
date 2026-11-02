/* Read the same EnglishControl as the game's real getCueSettings()/takeShot(). */
(function (root) {
    'use strict';
    function read(guide, angle) {
        var cue = guide.visualCue;
        var view = guide._gameView || (cue && cue._gameView);
        var pool = view && view.poolCanvas;
        var control = pool && pool.englishControl;
        // cueCanvas is normally just an Egret drawing Sprite, not the PoolCanvas.
        // Keep this last fallback for older integrations and standalone trial tables.
        if (!control && cue && cue._gameView && cue._gameView !== view) {
            pool = cue._gameView.poolCanvas;
            control = pool && pool.englishControl;
        }
        if (!control && cue && cue.cueCanvas) { control = cue.cueCanvas.englishControl; }
        var max = Number(root.PoolMath.CUE_PROPERTIES_MAX_POWER) || 350;
        var power = Number(cue ? cue.power : guide.power);
        var estimated = !isFinite(power) || power <= 0;
        var x = control ? Number(control.englishX) : 0;
        var y = control ? Number(control.englishY) : 0;
        return {angle: angle, power: estimated ? max : Math.max(.01, Math.min(max, power)),
            maxPower: max, estimated: estimated, mode: estimated ? 'full-power-preview' : 'current-power',
            englishX: isFinite(x) ? x : 0, englishY: isFinite(y) ? y : 0};
    }
    root.__poolGuideReadShotInputs = read;
}(window));
