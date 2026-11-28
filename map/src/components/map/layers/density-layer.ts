import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { PolygonLayer } from '@deck.gl/layers';
import { densityColor, shadeDensity, type DensityStyle, type ShadedCell } from '@/lib/constants/density';
import type { CoveragePolygon, StationDensity } from '@/lib/types/coverage';

/**
 * One station's reception density: its messages per H3 cell, colored on a log
 * spectrum. Cells with no reception are left empty.
 */
export function createDensityLayer(density: StationDensity, style: DensityStyle, light: boolean) {
  const data = shadeDensity(density.cells, density.maxCount);
  // A touch more opaque on light basemaps, where pale colors wash out
  const alpha = light ? 215 : 190;
  return new H3HexagonLayer<ShadedCell>({
    id: 'coverage-density',
    data,
    pickable: true,
    filled: true,
    extruded: false,
    // No outlines: neighboring cells of one band read as one contour
    stroked: false,
    getHexagon: (d) => d.h3,
    getFillColor: (d) => densityColor(d.t, style, alpha),
    updateTriggers: { getFillColor: [style, alpha] },
  });
}

/** Outline of the focused station's coverage polygon, over the density */
export function createDensityOutlineLayer(polygon: CoveragePolygon, light: boolean) {
  return new PolygonLayer<CoveragePolygon>({
    id: 'coverage-density-outline',
    data: [polygon],
    pickable: false,
    filled: false,
    stroked: true,
    getPolygon: (d) => d.coordinates[0],
    getLineColor: light ? [39, 39, 42, 230] : [244, 244, 245, 220],
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    updateTriggers: { getLineColor: [light] },
  });
}
