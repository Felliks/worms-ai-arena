type bool = boolean;

declare var $: any;
declare var Box2D: any;
declare var Stats: any;
declare var webkitAudioContext: any;
declare var BufferLoader: any;
declare var io: any;
declare var module: any;

interface JQueryStatic {
  browser: any;
}

interface Navigator {
  msMaxTouchPoints?: number;
}

interface Window {
  msRequestAnimationFrame?: typeof window.requestAnimationFrame;
  oRequestAnimationFrame?: typeof window.requestAnimationFrame;
}
