'use strict';
// Stable public interface; each implementation belongs to its own component.
const {motionLength,normalizeLayerDimensions,normalizeMotionProfile}=require('./motion/scene/normalization');
const {validateScene}=require('./motion/scene/schema');
const {motionAuthorContract,motionAuthorExample}=require('./motion/scene/authoring');
const {loadScene,productPhotoLayers}=require('./motion/scene/assets');
const {sceneRuntime}=require('./motion/scene/runtime');
const {sceneDocument,overlayScript,mountMediaOverlay}=require('./motion/scene/browser');
const {checkMotionSource}=require('./motion/scene/source');
const sceneRuntimeFiles=[
  require.resolve('./motion/scene/normalization'),
  require.resolve('./motion/scene/schema'),
  require.resolve('./motion/scene/authoring'),
  require.resolve('./motion/scene/assets'),
  require.resolve('./motion/scene/runtime'),
  require.resolve('./motion/scene/browser'),
  require.resolve('./motion/scene/source'),
];
module.exports={motionAuthorContract,motionAuthorExample,motionLength,normalizeLayerDimensions,normalizeMotionProfile,validateScene,loadScene,productPhotoLayers,sceneDocument,overlayScript,sceneRuntime,checkMotionSource,mountMediaOverlay,sceneRuntimeFiles};
