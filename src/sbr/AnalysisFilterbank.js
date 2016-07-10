import {TIME_SLOTS_RATE, WINDOW} from './constants';
import MDCT from '../mdct';

export default class AnalysisFilterbank {
  constructor() {
    this.X = new Float32Array(2 * 320);
    this.z = new Float32Array(320);
    this.mdct = new MDCT(128, 2);
  }
  
  // in: 1024 time samples, out: 32 x 32 complex
  process(inp, out[2][32][32][2], ch) {
    let x[2][320] = this.X;
    let k, inOff = 0;
    let z = this.z;
    
    // each loop creates 32 complex subband samples
    for (let l = 0; l < TIME_SLOTS_RATE; l++) {
      // 1. shift buffer
      for (k = 319; k >= 32; k--) {
        x[ch][k] = x[ch][k - 32];
      }

      // 2. add new samples
      for (k = 31; k >= 0; k--) {
        x[ch][k] = inp[inOff++];
      }

      // 3. windowing
      for (k = 0; k < 320; k++) {
        z[k] = x[ch][k] * WINDOW[2 * k];
      }

      // 4. sum samples
      for (k = 0; k < 64; k++) {
        z[k] = z[k] + z[k + 64] + z[k + 128] + z[k + 192] + z[k + 256];
      }
      
      // 5. pre IMDCT shuffle
      z[64] = z[0];
      z[65] = z[1];
      for (k = 1; k < 32; k++) {
        z[64 + 2 * k    ] = -z[64 - k];
        z[64 + 2 * k + 1] =  z[ k + 1];
      }

      // 6. calculate subband samples
      this.mdct.half(z, 64, z, 0);

      // 7. post IMDCT shuffle
      for (k = 0; k < 32; k++) {
        out[ch][l][k][0] = -z[63 - k];
        out[ch][l][k][1] = z[k];
      }
    }
  }
}
