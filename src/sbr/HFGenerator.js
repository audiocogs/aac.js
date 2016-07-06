import {makeArray} from './utils';
import {RATE, T_HF_ADJ} from './constants';

const RELAX_COEF = 1.000001;
const ALPHA_MAX = 16;
const CHIRP_COEFS = [[0.75, 0.25], [0.90625, 0.09375]];
//values for bw [invfModePrev][invfMode]
const BW_COEFS = [
  [0.0, 0.6, 0.9, 0.98],
  [0.6, 0.75, 0.9, 0.98],
  [0.0, 0.75, 0.9, 0.98],
  [0.0, 0.75, 0.9, 0.98]
];
const CHIRP_MIN = 0.015625;

// in: 32x40 complex Xlow, out: 32x40 complex Xhigh
export default function process(tables, cd, Xlow, Xhigh) {
  // calculate chirp factors
  let bwArray = calculateChirpFactors(tables, cd);

  // calculate inverse filter coefficients for bands 0-k0
  let k0 = tables.k0;
  let alpha0 = makeArray([k0, 2]);
  let alpha1 = makeArray([k0, 2]);
  calculateIFCoefs(tables, alpha0, alpha1, Xlow);

  // HF generation
  let patchCount = tables.patchCount;
  let patchSubbands = tables.patchSubbands;
  let patchStartSubband = tables.patchStartSubband;
  let kx = tables.kx;
  let m = tables.m;
  let Nq = tables.nq;
  let fNoise = tables.fNoise;

  let te = cd.te;
  let start = RATE * te[0];
  let end = RATE * te[cd.envCount];

  let alpha = new Float32Array(4);
  let square;
  let l, x; // loop indices
  let k = kx;
  let g = 0;

  for (let j = 0; j < patchCount; j++) {
    for (x = 0; x < patchSubbands[j]; x++, k++) {
      let p = patchStartSubband[j] + x;
      while (g <= Nq && k >= fNoise[g]) {
        g++;
      }
      g--;

      if (g < 0) {
        throw new Error("SBR: HFGenerator: no subband found for frequency " + k);
      }

      // fill Xhigh[k] (4.6.18.6.3)
      square = bwArray[g] * bwArray[g];
      alpha[0] = alpha1[p][0] * square;
      alpha[1] = alpha1[p][1] * square;
      alpha[2] = alpha0[p][0] * bwArray[g];
      alpha[3] = alpha0[p][1] * bwArray[g];
      for (l = start; l < end; l++) {
        let off = l + T_HF_ADJ;
        Xhigh[k][off][0] = alpha[0] * Xlow[p][off - 2][0]
          - alpha[1] * Xlow[p][off - 2][1]
          + alpha[2] * Xlow[p][off - 1][0]
          - alpha[3] * Xlow[p][off - 1][1]
          + Xlow[p][off][0];
            
        Xhigh[k][off][1] = alpha[0] * Xlow[p][off - 2][1]
          + alpha[1] * Xlow[p][off - 2][0]
          + alpha[2] * Xlow[p][off - 1][1]
          + alpha[3] * Xlow[p][off - 1][0]
          + Xlow[p][off][1];
      }
    }
  }

  // fill remaining with zero
  while (k < m + kx) {
    for (let j = 0; j < Xhigh[k].length; j++) {
      Xhigh[k][j][0] = 0;
      Xhigh[k][j][1] = 0;
    }
    k++;
  }
}

function calculateChirpFactors(tables, cd) {
  //calculates chirp factors and replaces old ones in ChannelData
  let nq = tables.nq;
  let invfMode = cd.invfMode;
  let invfModePrevious = cd.invfModePrevious;
  let bwArray = cd.bwArray;

  let tmp;
  let chirpCoefs;
  for (let i = 0; i < nq; i++) {
    tmp = BW_COEFS[invfModePrevious[i]][invfMode[i]];
    chirpCoefs = tmp < bwArray[i] ? CHIRP_COEFS[0] : CHIRP_COEFS[1];
    bwArray[i] = (chirpCoefs[0] * tmp) + (chirpCoefs[1] * bwArray[i]);
    if (bwArray[i] < CHIRP_MIN) {
      bwArray[i] = 0;
    }
  }

  return bwArray;
}

// calculates inverse filter coefficients for bands 0-k0 (4.6.18.6.2)
function calculateIFCoefs(tables, alpha0, alpha1, Xlow) {
  let k0 = tables.k0;
  let tmp = new Float32Array(2);

  let phi = makeArray([3, 2, 2]);
  let d;
  for (let k = 0; k < k0; k++) {
    //get covariance matrix
    getCovarianceMatrix(Xlow[k], phi, 0);
    // getCovarianceMatrix(Xlow[k], phi, 1);
    // getCovarianceMatrix(Xlow[k], phi, 2);

    // d(k)
    d = phi[2][1][0] * phi[1][0][0] - (phi[1][1][0] * phi[1][1][0] + phi[1][1][1] * phi[1][1][1]) / RELAX_COEF;

    // alpha1
    if (d === 0) {
      alpha1[k][0] = 0;
      alpha1[k][1] = 0;
    } else {
      tmp[0] = phi[0][0][0] * phi[1][1][0] - phi[0][0][1] * phi[1][1][1] - phi[0][1][0] * phi[1][0][0];
      tmp[1] = phi[0][0][0] * phi[1][1][1] + phi[0][0][1] * phi[1][1][0] - phi[0][1][1] * phi[1][0][0];
      alpha1[k][0] = tmp[0] / d;
      alpha1[k][1] = tmp[1] / d;
    }

    // alpha0
    if(phi[1][0][0] === 0) {
      alpha0[k][0] = 0;
      alpha0[k][1] = 0;
    } else {
      tmp[0] = phi[0][0][0] + alpha1[k][0] * phi[1][1][0] + alpha1[k][1] * phi[1][1][1];
      tmp[1] = phi[0][0][1] + alpha1[k][1] * phi[1][1][0] - alpha1[k][0] * phi[1][1][1];
      alpha0[k][0] = -tmp[0] / phi[1][0][0];
      alpha0[k][1] = -tmp[1] / phi[1][0][0];
    }

    if (alpha1[k][0] * alpha1[k][0] + alpha1[k][1] * alpha1[k][1] >= ALPHA_MAX
      || alpha0[k][0] * alpha0[k][0] + alpha0[k][1] * alpha0[k][1] >= ALPHA_MAX) {
      alpha1[k][0] = 0;
      alpha1[k][1] = 0;
      alpha0[k][0] = 0;
      alpha0[k][1] = 0;
    }
  }
}

// calculates covariance matrix (4.6.18.6.2)
function getCovarianceMatrix(x, phi, off) {
  // let sum = new Float32Array(2);
  // if (off === 0) {
  //   for (let i = 1; i < 38; i++) {
  //     sum[0] += x[i][0] * x[i][0] + x[i][1] * x[i][1];
  //   }
  //   phi[2][1][0] = sum[0] + x[0][0] * x[0][0] + x[0][1] * x[0][1];
  //   phi[1][0][0] = sum[0] + x[38][0] * x[38][0] + x[38][1] * x[38][1];
  // } else {
  //   for (let i = 1; i < 38; i++) {
  //     sum[0] += x[i][0] * x[i + off][0] + x[i][1] * x[i + off][1];
  //     sum[1] += x[i][0] * x[i + off][1] - x[i][1] * x[i + off][0];
  //   }
  //   phi[2 - off][1][0] = sum[0] + x[0][0] * x[off][0] + x[0][1] * x[off][1];
  //   phi[2 - off][1][1] = sum[1] + x[0][0] * x[off][1] - x[0][1] * x[off][0];
  //   if (off === 1) {
  //     phi[0][0][0] = sum[0] + x[38][0] * x[39][0] + x[38][1] * x[39][1];
  //     phi[0][0][1] = sum[1] + x[38][0] * x[39][1] - x[38][1] * x[39][0];
  //   }
  // }
  
  let real_sum2 = x[0][0] * x[2][0] + x[0][1] * x[2][1];
  let imag_sum2 = x[0][0] * x[2][1] - x[0][1] * x[2][0];
  let real_sum1 = 0.0, imag_sum1 = 0.0, real_sum0 = 0.0;
  for (let i = 1; i < 38; i++) {
    real_sum0 += x[i][0] * x[i    ][0] + x[i][1] * x[i    ][1];
    real_sum1 += x[i][0] * x[i + 1][0] + x[i][1] * x[i + 1][1];
    imag_sum1 += x[i][0] * x[i + 1][1] - x[i][1] * x[i + 1][0];
    real_sum2 += x[i][0] * x[i + 2][0] + x[i][1] * x[i + 2][1];
    imag_sum2 += x[i][0] * x[i + 2][1] - x[i][1] * x[i + 2][0];
  }
  phi[2 - 2][1][0] = real_sum2;
  phi[2 - 2][1][1] = imag_sum2;
  phi[2    ][1][0] = real_sum0 + x[ 0][0] * x[ 0][0] + x[ 0][1] * x[ 0][1];
  phi[1    ][0][0] = real_sum0 + x[38][0] * x[38][0] + x[38][1] * x[38][1];
  phi[2 - 1][1][0] = real_sum1 + x[ 0][0] * x[ 1][0] + x[ 0][1] * x[ 1][1];
  phi[2 - 1][1][1] = imag_sum1 + x[ 0][0] * x[ 1][1] - x[ 0][1] * x[ 1][0];
  phi[0    ][0][0] = real_sum1 + x[38][0] * x[39][0] + x[38][1] * x[39][1];
  phi[0    ][0][1] = imag_sum1 + x[38][0] * x[39][1] - x[38][1] * x[39][0];
}
