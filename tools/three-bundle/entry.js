import * as CORE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
window.THREE = Object.assign({}, CORE, {
  OrbitControls, TransformControls, GLTFLoader, GLTFExporter, MeshoptDecoder,
  OBJLoader, MTLLoader, OBJExporter, STLLoader, STLExporter, PLYLoader, PLYExporter,
  ThreeMFLoader, SVGLoader, BufferGeometryUtils, ConvexGeometry, RoundedBoxGeometry, LoftGeometry,
  Line2, LineSegments2, LineMaterial, LineGeometry, LineSegmentsGeometry, CSS2DRenderer, CSS2DObject
});
