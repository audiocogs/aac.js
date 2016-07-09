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

MDCT.prototype.process = function(input, inOffset, output, outOffset) {
    // local access
    var N2 = this.N2,
        N4 = this.N4,
        N8 = this.N8,
        buf[N4][2] = this.buf,
        tmp = this.tmp,
        sin = this.sin,
        cos = this.cos,
        fft = this.fft;
    
    // pre-IFFT complex multiplication
    let in1 = inOffset;
    let in2 = inOffset + N2 - 1;
    for (var k = 0; k < N4; k++) {
        buf[k][0] = (input[in2] * cos[k]) - (input[in1] * sin[k]);
        buf[k][1] = (input[in2] * sin[k]) + (input[in1] * cos[k]);
        in1 += 2;
        in2 -= 2;
    }
    
    // complex IFFT, non-scaling
    fft.process(buf, false);
    
    // post-IFFT complex multiplication
    for (let k = 0; k < N4; k++) {
        let r = buf[k][0];
        let i = buf[k][1];
        buf[k][0] = (r * cos[k]) - (i * sin[k]);
        buf[k][1] = (r * sin[k]) + (i * cos[k]);
    }
    
    // reordering
    for (var k = 0; k < N8; k += 2) {
        output[outOffset + 2 * k] = buf[N8 + k][1];
        output[outOffset + 2 + 2 * k] = buf[N8 + 1 + k][1];

        output[outOffset + 1 + 2 * k] = -buf[N8 - 1 - k][0];
        output[outOffset + 3 + 2 * k] = -buf[N8 - 2 - k][0];

        output[outOffset + N4 + 2 * k] = buf[k][0];
        output[outOffset + N4 + 2 + 2 * k] = buf[1 + k][0];

        output[outOffset + N4 + 1 + 2 * k] = -buf[N4 - 1 - k][1];
        output[outOffset + N4 + 3 + 2 * k] = -buf[N4 - 2 - k][1];

        output[outOffset + N2 + 2 * k] = buf[N8 + k][0];
        output[outOffset + N2 + 2 + 2 * k] = buf[N8 + 1 + k][0];

        output[outOffset + N2 + 1 + 2 * k] = -buf[N8 - 1 - k][1];
        output[outOffset + N2 + 3 + 2 * k] = -buf[N8 - 2 - k][1];

        output[outOffset + N2 + N4 + 2 * k] = -buf[k][1];
        output[outOffset + N2 + N4 + 2 + 2 * k] = -buf[1 + k][1];

        output[outOffset + N2 + N4 + 1 + 2 * k] = buf[N4 - 1 - k][0];
        output[outOffset + N2 + N4 + 3 + 2 * k] = buf[N4 - 2 - k][0];
    }
};

module.exports = MDCT;
