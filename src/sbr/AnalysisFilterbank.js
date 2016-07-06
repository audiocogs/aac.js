import {makeArray} from './utils';
import {TIME_SLOTS_RATE, WINDOW} from './constants';

export default class AnalysisFilterbank {
  constructor() {
    this.X = makeArray([2, 320]);
    this.z = new Float32Array(320);
    this.u = new Float32Array(64);
    
    this.COEFS = makeArray([32, 64, 2]);
    let tmp;
    for (let k = 0; k < 32; k++) {
      for (let n = 0; n < 64; n++) {
        tmp = Math.PI / 64.0 * (k + 0.5) * (2 * n - 0.5);
        this.COEFS[k][n][0] = 2 * Math.cos(tmp);
        this.COEFS[k][n][1] = 2 * Math.sin(tmp);
      }
    }
  }
  
  // in: 1024 time samples, out: 32 x 32 complex
  process(inp, out, ch) {
    let x = this.X[ch];
    let n, k, inOff = 0;
    
    // each loop creates 32 complex subband samples
    for (let l = 0; l < TIME_SLOTS_RATE; l++) {
      // 1. shift buffer
      for (n = 319; n >= 32; n--) {
        x[n] = x[n - 32];
      }

      // 2. add new samples
      for (n = 31; n >= 0; n--) {
        x[n] = inp[inOff];
        inOff++;
      }

      // 3. windowing
      for (n = 0; n < 320; n++) {
        this.z[n] = x[n] * WINDOW[2 * n];
      }

      // 4. sum samples
      for (n = 0; n < 64; n++) {
        this.u[n] = this.z[n];
        for (k = 1; k < 5; k++) {
          this.u[n] += this.z[n + k * 64];
        }
      }

      // 5. calculate subband samples, TODO: replace with FFT?
      for (k = 0; k < 32; k++) {
        out[l][k][0] = this.u[0] * this.COEFS[k][0][0];
        out[l][k][1] = this.u[0] * this.COEFS[k][0][1];
        for (n = 1; n < 64; n++) {
          out[l][k][0] += this.u[n] * this.COEFS[k][n][0];
          out[l][k][1] += this.u[n] * this.COEFS[k][n][1];
        }
      }
    }
  }
}
