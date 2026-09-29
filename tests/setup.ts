import '@testing-library/jest-dom/vitest'

// jsdom does not implement Element.prototype.scrollTo, which the build log
// uses for auto-scroll. Real browsers provide it, so stub it in tests.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = () => {}
}
