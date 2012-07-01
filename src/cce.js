var CCEElement = (function() {
    
    function CCEElement(config) {
        this.ics = new ICStream(config);
        this.channelPair = new Array(8);
        this.idSelect = new Int32Array(8);
        this.chSelect = new Int32Array(8);
        this.gain = new Array(16);
    }
    
    CCEElement.BEFORE_TNS = 0;
    CCEElement.AFTER_TNS = 1;
    CCEElement.AFTER_IMDCT = 2;
    
    const CCE_SCALE = new Float32Array([
        1.09050773266525765921,
        1.18920711500272106672,
        1.4142135623730950488016887,
        2.0
    ]);
    
    CCEElement.prototype = {
        decode: function(stream, config) {
            var channelPair = this.channelPair,
                idSelect = this.idSelect,
                chSelect = this.chSelect;
    
            this.couplingPoint = 2 * stream.readOne();
            this.coupledCount = stream.readSmall(3);
    
            var gainCount = 0;
            for (var i = 0; i <= this.coupledCount; i++) {
                gainCount++;
                channelPair[i] = stream.readOne();
                idSelect[i] = stream.readSmall(4);
    
                if (channelPair[i]) {
                    chSelect[i] = stream.readSmall(2);
                    if (chSelect[i] === 3)
                        gainCount++;
    
                } else {
                    chSelect[i] = 2;
                }
            }
    
            this.couplingPoint += stream.readOne() || (this.couplingPoint >>> 1);
    
            var sign = stream.readOne(),
                scale = CCE_SCALE[stream.readSmall(2)];
    
            this.ics.decode(stream, config, false);
    
            var groupCount = this.ics.info.groupCount,
                maxSFB = this.ics.info.maxSFB,
                bandTypes = this.ics.bandTypes;
    
            for (var i = 0; i < gainCount; i++) {
                var idx = 0,
                    cge = 1,
                    gain = 0,
                    gainCache = 1;
    
                if (i > 0) {
                    cge = this.couplingPoint === CCEElement.AFTER_IMDCT ? 1 : stream.readOne();
                    gain = cge ? Huffman.decodeScaleFactor(stream) - 60 : 0;
                    gainCache = Math.pow(scale, -gain);
                }
    
                var gain_i = this.gain[i] = new Float32Array(120);
    
                if (this.couplingPoint === CCEElement.AFTER_IMDCT) {
                    gain_i[0] = gainCache;
                } else {
                    for (var g = 0; g < groupCount; g++) {
                        for (var sfb = 0; sfb < maxSFB; sfb++) {
                            if (bandTypes[idx] !== ICStream.ZERO_BT) {
                                if (cge === 0) {
                                    var t = Huffman.decodeScaleFactor(stream) - 60;
                                    if (t !== 0) {
                                        var s = 1;
                                        t = gain += t;
                                        if (sign) {
                                            s -= 2 * (t * 0x1);
                                            t >>>= 1;
                                        }
                                        gainCache = Math.pow(scale, -t) * s;
                                    }
                                }
                                gain_i[idx++] = gainCache;
                            }
                        }
                    }
                }
            }
        },
    
        applyIndependentCoupling: function(index, data) {
            var gain = this.gain[index][0],
                iqData = this.ics.data;
    
            for (var i = 0; i < data.length; i++) {
                data[i] += gain * iqData[i];
            }
        },
    
        applyDependentCoupling: function(index, data) {
            var info = this.ics.info,
                swbOffsets = info.swbOffsets,
                groupCount = info.groupCount,
                maxSFB = info.maxSFB,
                bandTypes = this.ics.bandTypes,
                iqData = this.ics.data;
    
            var idx = 0,
                offset = 0,
                gains = this.gain[index];
    
            for (var g = 0; g < groupCount; g++) {
                var len = info.groupLength[g];
    
                for (var sfb = 0; sfb < maxSFB; sfb++, idx++) {
                    if (bandTypes[idx] !== ICStream.ZERO_BT) {
                        var gain = gains[idx];
                        for (var group = 0; group < len; group++) {
                            for (var k = swbOffsets[sfb]; k < swbOffsets[swb + 1]; k++) {
                                data[offset + group * 128 + k] += gain * iqData[offset + group * 128 + k];
                            }
                        }
                    }
                }
    
                offset += len * 128;
            }
        }
    };
    
    return CCEElement;
    
})();