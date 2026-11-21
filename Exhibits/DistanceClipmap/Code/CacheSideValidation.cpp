/*============================================================================================================================================
                                                          CACHESIDEVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Reproduce an outward-only radiance-cache defect against explicit back-facing Lambertian point-light evaluation.

#include "Experimental/DistanceClipmap/RadianceScene.h"
#include <iostream>
#include <iomanip>

using namespace Frontier::DistanceClipmapExperiment;

int main(int ArgumentCount, char** Arguments)
{
    try
    {
        Require(ArgumentCount == 2, "Usage: CacheSideValidation <vehicle archive directory>");
        RadianceScene Scene;
        Scene.Construct(Arguments[1]);
        Scene.Relight(Point, 1);
        double   MaximumError = 0, ControlError = 0;
        unsigned Disagreements = 0;
        for (unsigned Face = 0; Face < Scene.Vehicle.Surfaces.size(); ++Face)
        {
            auto Reverse             = Scene.FacetCentre(Scene.Vehicle.Surfaces[Face], true, Face);
            Reverse.Normal           = -Reverse.Normal;
            Reverse.GeometricNormal  = -Reverse.GeometricNormal;
            Reverse.RadiantFacing    = false;
            const Vector Expected    = Scene.Direct(Reverse, Point, VisibilityEvaluation::Exact, 1);
            const Vector Actual      = Scene.CachedRadiance(Reverse);
            const Vector OutwardOnly = Scene.VehicleCache[Face];
            const double Error       = Length(Expected - Actual);
            MaximumError             = std::max(MaximumError, Error);
            ControlError             = std::max(ControlError, double(Length(Expected - OutwardOnly)));
            Disagreements += Error > 1e-6;
        }
        std::cout << std::setprecision(12) << "{\"tested_reverse_sides\":" << Scene.Vehicle.Surfaces.size()
                  << ",\"disagreements\":" << Disagreements << ",\"max_vector_radiance_error\":" << MaximumError
                  << ",\"outward_only_negative_control_error\":" << ControlError << "}\n";
        return Disagreements ? 2 : 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << Error.what() << '\n';
        return 1;
    }
}
