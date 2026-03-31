import '@testing-library/jest-dom/vitest';

// Mock Canvas for Semi-UI lottie
HTMLCanvasElement.prototype.getContext = () => {
  return {
    fillStyle: '',
    fillRect: Object,
    clearRect: Object,
    getImageData: Object,
    putImageData: Object,
    createImageData: Object,
    setTransform: Object,
    drawImage: Object,
    save: Object,
    fillText: Object,
    restore: Object,
    beginPath: Object,
    moveTo: Object,
    lineTo: Object,
    closePath: Object,
    stroke: Object,
    translate: Object,
    scale: Object,
    rotate: Object,
    arc: Object,
    fill: Object,
    measureText: () => ({ width: 0 }),
    transform: Object,
    rect: Object,
    clip: Object,
  } as any;
};

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock ResizeObserver
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;
