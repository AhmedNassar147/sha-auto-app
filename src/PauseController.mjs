// pauseController.mjs
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

class PauseController {
  constructor() {
    this.paused = false;
    this._gate = null; // {promise, resolve}
  }

  pause() {
    if (!this.paused) {
      this.paused = true;
      this._gate = defer();
    }
  }

  continueIfPaused() {
    if (this.paused) {
      this.paused = false;
      // Release anyone awaiting the gate
      this._gate?.resolve();
      this._gate = null;
    }
  }

  // Await this at checkpoints; returns immediately if not paused.
  async waitIfPaused() {
    if (!this.paused) return;
    // Wait until continueIfPaused() resolves the gate
    await this._gate.promise;
  }

  isPaused() {
    return this.paused;
  }
}

export const pauseController = new PauseController();

// convenience named exports
export const pause = () => pauseController.pause();
export const continueIfPaused = () => pauseController.continueIfPaused();
