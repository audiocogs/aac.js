/*
 * AAC.js - Advanced Audio Coding decoder in JavaScript
 * Created by Devon Govett
 * Copyright (c) 2012, Official.fm Labs
 *
 * AAC.js is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU Lesser General Public License as 
 * published by the Free Software Foundation; either version 3 of the 
 * License, or (at your option) any later version.
 *
 * AAC.js is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY 
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General 
 * Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library.
 * If not, see <http://www.gnu.org/licenses/>.
 */

var FFT = require('./fft');

// Modified Discrete Cosine Transform
function MDCT(length, scale) {
  this.N = length;
  this.N2 = length >>> 1;
  this.N4 = length >>> 2;
  this.N8 = length >>> 3;
  
  this.sin = new Float32Array(this.N4);
  this.cos = new Float32Array(this.N4);
  
  let theta = 1.0 / 8.0 + (scale < 0 ? this.N4 : 0);
  scale = Math.sqrt(Math.abs(scale));
  for (let i = 0; i < this.N4; i++) {
    let alpha = 2 * Math.PI * (i + theta) / length;
    this.sin[i] = -Math.sin(alpha) * scale;
    this.cos[i] = -Math.cos(alpha) * scale;
  }
  
  this.fft = new FFT(this.N4);
  this.buf = new Float32Array(this.N4 * 2);
}

/**
 * Computes the middle half of the imdct of size N. Excludes the parts that
 * can be derived by symmetry. Input N/2 samples, output N/2 samples.
 */
MDCT.prototype.half = function(input, inOffset, output, outOffset) {
  // local access
  let N2 = this.N2;
  let N4 = this.N4;
  let N8 = this.N8;
  let buf[N4][2] = outOffset ? output.subarray(outOffset) : output;
  let sin = this.sin;
  let cos = this.cos;

  // pre-IFFT complex multiplication
  let in1 = inOffset;
  let in2 = inOffset + N2 - 1;
  for (let k = 0; k < N4; k++) {
    buf[k][0] = (input[in2] * cos[k]) - (input[in1] * sin[k]);
    buf[k][1] = (input[in2] * sin[k]) + (input[in1] * cos[k]);
    in1 += 2;
    in2 -= 2;
  }
  
  // complex IFFT, non-scaling
  this.fft.process(buf, false);
  
  for (let k = 0; k < N8; k++) {
    let r0 = (buf[N8 - k - 1][1] * sin[N8 - k - 1]) - (buf[N8 - k - 1][0] * cos[N8 - k - 1]);
    let i1 = (buf[N8 - k - 1][1] * cos[N8 - k - 1]) + (buf[N8 - k - 1][0] * sin[N8 - k - 1]);
    let r1 = (buf[N8 + k][1] * sin[N8 + k]) - (buf[N8 + k][0] * cos[N8 + k]);
    let i0 = (buf[N8 + k][1] * cos[N8 + k]) + (buf[N8 + k][0] * sin[N8 + k]);
    
    buf[N8 - k - 1][0] = r0;
    buf[N8 - k - 1][1] = i0;
    buf[N8 + k][0] = r1;
    buf[N8 + k][1] = i1;
  }
};

/**
 * Computes the imdct of size N. Input N/2 samples, output N samples.
 */
MDCT.prototype.full = function(input, inOffset, output, outOffset) {
  // local access
  let N = this.N;
  let N2 = this.N2;
  let N4 = this.N4;
  let buf = output;
  
  this.half(input, inOffset, output, outOffset + N4);
  
  for (let k = 0; k < N4; k++) {
    output[outOffset + k] = -output[outOffset + N2 - k - 1];
    output[outOffset + N - k - 1] = output[outOffset + N2 + k];
  }
};

module.exports = MDCT;
