//import "tables.js"
//import "huffman.js"

const MAX_SECTIONS = 120,
      MAX_WINDOW_GROUP_COUNT = 8;
      
const ONLY_LONG_SEQUENCE = 0,
      LONG_START_SEQUENCE = 1,
      EIGHT_SHORT_SEQUENCE = 2,
      LONG_STOP_SEQUENCE = 3;
      
const ZERO_BT = 0,         // Scalefactors and spectral data are all zero.
      FIRST_PAIR_BT = 5,   // This and later band types encode two values (rather than four) with one code word.
      ESC_BT = 11,         // Spectral data are coded with an escape sequence.
      NOISE_BT = 13,       // Spectral data are scaled white noise not coded in the bitstream.
      INTENSITY_BT2 = 14,  // Scalefactor data are intensity stereo positions.
      INTENSITY_BT = 15;   // Scalefactor data are intensity stereo positions.
      
const SF_DELTA = 60,
      SF_OFFSET = 200;

function ICStream(frameLength) {
    this.info = new ICSInfo();
    this.bandTypes = new Int32Array(MAX_SECTIONS);
    this.sectEnd = new Int32Array(MAX_SECTIONS);
    this.data = new Float32Array(frameLength);
    this.scaleFactors = new Float32Array(MAX_SECTIONS);
    this.randomState = 0x1F2E3D4C;
}

ICStream.prototype = {
    decode: function(stream, config, commonWindow) {
        this.globalGain = stream.read(8);
        
        if (!commonWindow)
            this.info.decode(stream, config, commonWindow);
            
        this.decodeBandTypes(stream, config);
        this.decodeScaleFactors(stream);
        
        if (stream.readOne()) { // pulse present
            if (this.info.windowSequence === EIGHT_SHORT_SEQUENCE)
                throw new Error("Pulse tool not allowed in eight short sequence.");
                
            this.decodePulseData();
        }
        
        if (stream.readOne()) { // tns data present
            throw new Error("TODO: decode_tns")
        }
        
        if (stream.readOne()) { // gain control present
            throw new Error("TODO: decode gain control/SSR")
        }
        
        this.decodeSpectralData(stream);
    },
    
    decodeBandTypes: function(stream, config) {
        var bits = this.info.windowSequence === EIGHT_SHORT_SEQUENCE ? 3 : 5,
            groupCount = this.info.groupCount,
            maxSFB = this.info.maxSFB,
            bandTypes = this.bandTypes,
            sectEnd = this.sectEnd,
            idx = 0,
            escape = (1 << bits) - 1;
        
        for (var g = 0; g < groupCount; g++) {
            var k = 0;
            while (k < maxSFB) {
                var end = k,
                    bandType = stream.readSmall(4);
                    
                if (bandType === 12)
                    throw new Error("Invalid band type");
                    
                var incr;
                while ((incr = stream.read(bits)) === escape)
                    end += incr;
                    
                end += incr;
                
                if (end > maxSFB)
                    throw new Error("Too many bands (" + end + " > " + maxSFB + ")");
                    
                for (; k < end; k++) {
                    bandTypes[idx] = bandType;
                    sectEnd[idx++] = end;
                }
            }
        }
    },
    
    decodeScaleFactors: function(stream) {
        var groupCount = this.info.groupCount,
            maxSFB = this.info.maxSFB,
            offset = new Int32Array([this.globalGain, this.globalGain - 90, 0]), // spectrum, noise, intensity
            idx = 0,
            noiseFlag = true,
            scaleFactors = this.scaleFactors;
            
        for (var g = 0; g < groupCount; g++) {
            for (var i = 0; i < maxSFB;) {
                var runEnd = this.sectEnd[idx];
                
                switch (this.bandTypes[idx]) {
                    case ZERO_BT:
                        for (; i < runEnd; i++) {
                            scaleFactors[idx++] = 0;
                        }
                        break;
                        
                    case INTENSITY_BT:
                    case INTENSITY_BT2:
                        for(; i < runEnd; i++) {
                            offset[2] += Huffman.decodeScaleFactor(stream) - SF_DELTA;
                            var tmp = Math.min(Math.max(offset[2], -155), 100);
                            scaleFactors[idx++] = SCALEFACTOR_TABLE[-tmp + SF_OFFSET];
                        }
                        break;
                        
                    case NOISE_BT:
                        for(; i < runEnd; i++) {
                            if (noiseFlag) {
                                offset[1] += stream.readSmall(9) - 256;
                                noiseFlag = false;
                            } else {
                                offset[1] += Huffman.decodeScaleFactor(stream) - SF_DELTA;
                            }
                            var tmp = Math.min(Math.max(offset[1], -100), 155);
                            scaleFactors[idx++] = -SCALEFACTOR_TABLE[tmp + SF_OFFSET];
                        }
                        break;
                        
                    default:
                        for(; i < runEnd; i++) {
                            offset[0] += Huffman.decodeScaleFactor(stream) - SF_DELTA;
                            if(offset[0] > 255) 
                                throw new Error("Scalefactor out of range: " + offset[0]);
                                
                            scaleFactors[idx++] = SCALEFACTOR_TABLE[offset[0] - 100 + SF_OFFSET];
                        }
                        break;
                }
            }
        }
    },
    
    decodePulseData: function(stream) {
        var pulseCount = stream.readSmall(2) + 1,
            pulseSWB = stream.readSmall(6);
            
        if (pulseSWB >= this.info.swbCount)
            throw new Error("Pulse SWB out of range: " + pulseSWB);
            
        if (!this.pulseOffset || this.pulseOffset.length !== pulseCount) {
            // only reallocate if needed
            this.pulseOffset = new Int32Array(pulseCount);
            this.pulseAmp = new Int32Array(pulseCount);
        }
        
        this.pulseOffset[0] = this.info.swbOffsets[pulseSWB] + stream.readSmall(5);
        this.pulseAmp[0] = stream.readSmall(4);
        
        if (this.pulseOffset[0] > 1023)
            throw new Error("Pulse offset out of range: " + this.pulseOffset[0]);
        
        for (var i = 1; i < pulseCount; i++) {
            this.pulseOffset[i] = stream.readSmall(5) + this.pulseOffset[i - 1];
            if (this.pulseOffset[i] > 1023)
                throw new Error("Pulse offset out of range: " + this.pulseOffset[i]);
                
            this.pulseAmp[i] = stream.readSmall(4);
        }
    },
    
    decodeSpectralData: function(stream) {
        var data = this.data,
            info = this.info,
            maxSFB = info.maxSFB,
            windowGroups = info.groupCount,
            offsets = info.swbOffsets,
            bandTypes = this.bandTypes,
            buf = new Int32Array(4);
            
        var groupOff = 0, idx = 0;
        for (var g = 0; g < windowGroups; g++) {
            var groupLen = info.groupLength[g];
            
            for (var sfb = 0; sfb < maxSFB; sfb++, idx++) {
                var hcb = bandTypes[idx],
                    off = groupOff + offsets[sfb],
                    width = offsets[sfb + 1] - offsets[sfb];
                    
                if (hcb === ZERO_BT || hcb >= INTENSITY_BT2) {
                    for (var group = 0; group < groupLen; group++, off += 128) {
                        for (var i = off; i < off + width; i++) {
                            data[i] = 0;
                        }
                    }
                } else if (hcb === NOISE_BT) {
                    // fill with random values
                    for (var group = 0; group < groupLen; group++, off += 128) {
                        var energy = 0;
                        
                        for (var k = 0; k < width; k++) {
                            this.randomState *= 1664525 + 1013904223;
                            data[off + k] = this.randomState;
                            energy += data[off + k] * data[off + k];
                        }
                        
                        var scale = this.scaleFactors[idx] / Math.sqrt(energy);
                        for (var k = 0; k < width; k++) {
                            data[off + k] *= scale;
                        }
                    }
                } else {
                    for (var group = 0; group < groupLen; group++, off += 128) {
                        var num = (hcb >= FIRST_PAIR_BT) ? 2 : 4;
                        for (var k = 0; k < width; k += num) {
                            Huffman.decodeSpectralData(stream, hcb, buf, 0);
                            
                            // inverse quantization & scaling
                            for (var j = 0; j < num; j++) {
                                data[off + k + j] = (buf[j] > 0) ? IQ_TABLE[buf[j]] : -IQ_TABLE[-buf[j]];
                                data[off + k + j] *= scaleFactors[idx];
                            }
                        }
                    }
                }
            }
            groupOff += groupLen << 7;
        }
    }
}

function ICSInfo() {
    this.windowShape = new Int32Array(2);
    this.windowSequence = ONLY_LONG_SEQUENCE;
    this.groupLength = new Int32Array(MAX_WINDOW_GROUP_COUNT);
    this.ltpData1Present = false;
    this.ltpData2Present = false;
}

ICSInfo.prototype = {
    decode: function(stream, config, commonWindow) {
        stream.advance(1); // reserved
        
        this.windowSequence = stream.readSmall(2);
        this.windowShape[0] = this.windowShape[1];
        this.windowShape[1] = stream.readOne();
        
        this.groupCount = 1;
        this.groupLength[0] = 1;
        
        if (this.windowSequence === EIGHT_SHORT_SEQUENCE) {
            this.maxSFB = stream.readSmall(4);
            for (var i = 0; i < 7; i++) {
                if (stream.readOne()) {
                    this.groupLength[this.groupCount - 1]++;
                } else {
                    this.groupCount++;
                    this.groupLength[this.groupCount - 1] = 1;
                }
            }
            
            this.windowCount = 8;
            this.swbOffsets = SWB_OFFSET_128[config.sampleIndex];
            this.swbCount = SWB_SHORT_WINDOW_COUNT[config.sampleIndex];
            this.predictorPresent = false;
        } else {
            this.maxSFB = stream.readSmall(6);
            this.windowCount = 6;
            this.swbOffsets = SWB_OFFSET_1024[config.sampleIndex];
            this.swbCount = SWB_LONG_WINDOW_COUNT[config.sampleIndex];
            this.predictorPresent = stream.readOne();
            
            if (this.predictorPresent)
                this.decodePrediction(stream, config, commonWindow);
        }
    },
    
    decodePrediction: function(stream, config, commonWindow) {
        switch (config.profile) {
            case AOT_AAC_MAIN:
                throw new Error('Prediction not implemented.');
                break;
                
            case AOT_AAC_LTP:
                throw new Error('LTP prediction not implemented.');
                break;
                
            default:
                throw new Error('Unsupported profile for prediction ' + config.profile);
        }
    }
}