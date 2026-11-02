/* GameViewBase cue methods extracted from the inspected hot-update script.
 * Source SHA-256: 548d726727ab070df4b447a837a88e606d8b61d43a41692fec22682c73cd833a
 * Character offsets 204577 and 204979; cueDataRate is 1.4 at offset 214372.
 * Kept inert until the offline Node harness explicitly evaluates this fixture.
 */
(function () {
    var t = GameViewBase;
    t.cueDataRate = 1.4;
    t.prototype.setShootBallData=function(e,i,n,s){var o=t.cueDataRate;this._cueShowSpin=n,this._cueForce=e/o,this._cueTipLine=i>0?i/o:300,this._cueSpin=n>0?n/o:400,s&&this.cleanDaoJuData(),this.updateShootBallData()};
    t.prototype.updateShootBallData=function(){PoolMath.CUE_PROPERTIES_MAX_POWER=this._cueForce*this._daojupowerBet,PoolMath.CUE_PROPERTIES_MAX_POWER>1e3&&(PoolMath.CUE_PROPERTIES_MAX_POWER=1e3);var e=this._cueTipLine*this._daojuaimBet;e>1e3&&(e=1e3),PoolMath.CUE_PROPERTIES_ACCURACY=e/1e3,PoolMath.CUE_PROPERTIES_ACCURACY>4&&(PoolMath.CUE_PROPERTIES_ACCURACY=4),this.poolCanvas.visualCue.visualGuide.updateGuide();var t=this._cueSpin*this._daojurotateBet;t>1e3&&(t=1e3),BaseDef.CUR_CUE_SPIN=this._cueShowSpin*this._daojurotateBet,this._crossView&&this._crossView.update(),PoolMath.CUE_PROPERTIES_SPIN=t/1e3,PoolMath.CUE_PROPERTIES_SPIN>1&&(PoolMath.CUE_PROPERTIES_SPIN=1),this.poolCanvas.crossView&&this.poolCanvas.crossView.updateData(),this.powerLabel&&(this.powerLabel.text="MAX "+PoolMath.CUE_PROPERTIES_MAX_POWER),this.saveLevelDaoJuData()};
}());
