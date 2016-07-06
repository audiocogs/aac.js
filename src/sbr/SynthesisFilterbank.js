import {makeArray} from './utils';
import {TIME_SLOTS_RATE, WINDOW} from './constants';

export default class SynthesisFilterbank {
  constructor() {
    this.V = makeArray([2, 1280]); // for both channels
    this.g = new Float32Array(640); // tmp buffer
    this.w = new Float32Array(640);

    //complex coefficients:
    this.COEFS = makeArray([128, 64, 2]);
    let fac = 1.0 / 64.0;
    let tmp;
    for (let n = 0; n < 128; n++) {
      for(let k = 0; k < 64; k++) {
        tmp = Math.PI / 128 * (k + 0.5) * (2 * n - 255);
        this.COEFS[n][k][0] = fac * Math.cos(tmp);
        this.COEFS[n][k][1] = fac * Math.sin(tmp);
      }
    }
  }

  // in: 64 x 32 complex, out: 2048 time samples
  process(inp, out, ch) {
    let v = this.V[ch];
    let n, k, outOff = 0;

    // each loop creates 64 output samples
    for (let l = 0; l < TIME_SLOTS_RATE; l++) {
      // 1. shift buffer
      for (n = 1279; n >= 128; n--) {
        v[n] = v[n - 128];
      }

      // 2. multiple input by matrix and save in buffer
      for (n = 0; n < 128; n++) {
        v[n] = (inp[0][l][0] * this.COEFS[n][0][0]) - (inp[0][l][1] * this.COEFS[n][0][1]);
        for (k = 1; k < 64; k++) {
          v[n] += (inp[k][l][0] * this.COEFS[n][k][0]) - (inp[k][l][1] * this.COEFS[n][k][1]);
          // if (isNaN(inp[k][l][0])) {
          //   throw new Error('NAN')
          // }
        }
      }

      // 3. extract samples
      for (n = 0; n < 5; n++) {
        for (k = 0; k < 64; k++) {
          this.g[128 * n + k] = v[256 * n + k];
          this.g[128 * n + 64 + k] = v[256 * n + 192 + k];
        }
      }

      // 4. window signal
      for (n = 0; n < 640; n++) {
        this.w[n] = this.g[n] * WINDOW[n];
      }

      // 5. calculate output samples
      for (let i = 0; i < 64; i++) {
        out[outOff] = this.w[i];
        for (let j = 1; j < 10; j++) {
          out[outOff] = out[outOff] + this.w[64 * j + i];
        }
        outOff++;
      }
    }
  }
}
