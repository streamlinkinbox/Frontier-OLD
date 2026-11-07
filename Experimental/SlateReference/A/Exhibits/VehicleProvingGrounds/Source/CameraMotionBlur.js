//============================================================================================================================================
//                                                            CAMERAMOTIONBLUR.JS
//============================================================================================================================================
// 🧩 Camera-owned motion-blur component used by the Vehicle Proving Grounds presentation path only.

export class CameraMotionBlur
{
    constructor({ Enabled = false, Strength = 0.7 } = {})
    {
        this.Enabled = !!Enabled;
        this.Strength = Math.max(0.0, Math.min(1.0, Number(Strength) || 0.0));
    }

    ResolveStrength()
    {
        return this.Enabled ? Math.max(0.0, Math.min(1.0, Number(this.Strength) || 0.0)) : 0.0;
    }
}
