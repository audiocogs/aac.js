//import "ics.js"
//import "cpe.js"
//import "cce.js"
//import "filter_bank.js"

AACDecoder = Decoder.extend(function() {
    Decoder.register('mp4a', this)
    Decoder.register('aac ', this)
    
    const SAMPLE_RATES = new Int32Array([
        96000, 88200, 64000, 48000, 44100, 32000,
        24000, 22050, 16000, 12000, 11025, 8000, 7350    
    ]);
    
    // AAC profiles
    const AOT_AAC_MAIN = 1,
          AOT_AAC_LC = 2,
          AOT_AAC_LTP = 4,
          AOT_ESCAPE = 31;
          
    // Channel configurations
    const CHANNEL_CONFIG_NONE = 0,
          CHANNEL_CONFIG_MONO = 1,
          CHANNEL_CONFIG_STEREO = 2,
          CHANNEL_CONFIG_STEREO_PLUS_CENTER = 3,
          CHANNEL_CONFIG_STEREO_PLUS_CENTER_PLUS_REAR_MONO = 4,
          CHANNEL_CONFIG_FIVE = 5,
          CHANNEL_CONFIG_FIVE_PLUS_ONE = 6,
          CHANNEL_CONFIG_SEVEN_PLUS_ONE = 8;
    
    this.prototype.setCookie = function(buffer) {
        var data = Stream.fromBuffer(buffer),
            stream = new Bitstream(data);
        
        this.config = {};
        
        this.config.profile = stream.readSmall(5);
        if (this.config.profile === AOT_ESCAPE)
            this.config.profile = 32 + stream.readSmall(6);
            
        this.config.sampleIndex = stream.readSmall(4);
        this.config.sampleRate = (this.config.sampleIndex === 0x0f ? stream.read(24) : SAMPLE_RATES[this.config.sampleIndex]);
            
        this.config.chanConfig = stream.readSmall(4);
        
        switch (this.config.profile) {
            case AOT_AAC_MAIN:
            case AOT_AAC_LC:
            case AOT_AAC_LTP:
                if (stream.readOne()) // frameLengthFlag
                    return this.emit('error', 'frameLengthFlag not supported');
                    
                this.config.frameLength = 1024;
                    
                if (stream.readOne()) // dependsOnCoreCoder
                    stream.advance(14); // coreCoderDelay
                    
                if (stream.readOne()) { // extensionFlag
                    if (this.config.profile > 16) { // error resiliant profile
                        this.config.sectionDataResilience = stream.readOne();
                        this.config.scalefactorResilience = stream.readOne();
                        this.config.spectralDataResilience = stream.readOne();
                    }
                    
                    stream.advance(1);
                }
                
                if (this.config.chanConfig === CHANNEL_CONFIG_NONE) {
                    stream.advance(4) // element_instance_tag
                    this.emit('error', 'PCE unimplemented');
                }
                
                break;
                
            default:
                this.emit('error', 'AAC profile ' + this.config.profile + ' not supported.');
                return;
        }
        
        this.filter_bank = new FilterBank(false, this.config.chanConfig);
        console.log(this.config);
    }
    
    const SCE_ELEMENT = 0,
          CPE_ELEMENT = 1,
          CCE_ELEMENT = 2,
          LFE_ELEMENT = 3,
          DSE_ELEMENT = 4,
          PCE_ELEMENT = 5,
          FIL_ELEMENT = 6,
          END_ELEMENT = 7;
    
    this.prototype.readChunk = function() {
        var stream = this.bitstream;
        
        if (!stream.available(1))
            return this.once('available', this.readChunk);
        
        if (stream.peek(12) === 0xfff) {
            this.emit('error', 'adts header') // NOPE
        }
        
        this.cces = [];
        var elements = [],
            config = this.config,
            frameLength = config.frameLength,
            elementType = null;
        
        // Table 4.3    
        while ((elementType = stream.readSmall(3)) !== END_ELEMENT) {
            var id = stream.readSmall(4);
            
            switch (elementType) {
                case SCE_ELEMENT:
                case LFE_ELEMENT:
                    console.log('sce or lfe')
                    
                    var ics = new ICStream(frameLength);
                    ics.id = id;
                    elements.push(ics);
                    ics.decode(stream, config, false);
                    break;
                    
                case CPE_ELEMENT:
                    // console.log('cpe')
                    
                    var cpe = new CPEElement(frameLength);
                    cpe.id = id;
                    elements.push(cpe);
                    cpe.decode(stream, config);
                    break;
                    
                case CCE_ELEMENT:
                    console.log('cce')
                    
                    var cce = new CCEElement(frameLength);
                    this.cces.push(cce);
                    cce.decode(stream, config);
                    break;
                    
                case DSE_ELEMENT:
                    console.log('dse');
                    
                    var align = stream.readOne(),
                        count = stream.readSmall(8);
                        
                    if (count === 255)
                        count += stream.readSmall(8);
                        
                    if (align)
                        stream.align();
                        
                    // skip for now...
                    stream.advance(count * 8);
                    break;
                    
                case PCE_ELEMENT:
                    console.log('pce')
                    break;
                    
                case FIL_ELEMENT:
                    console.log('fil')
                    
                    if (id === 15)
                        id += stream.read(8) - 1;
                        
                    // skip for now...
                    stream.advance(count * 8);
                    break;
                    
                default:
                    return this.emit('error', 'Unknown element')
            }
        }
        
        this.process(elements);
        
        stream.align();
        
        // Interleave channels
        var data = this.data,
            channels = data.length,
            len = this.config.frameLength,
            output = new Int16Array(len * channels),
            j = 0;
            
        for (var k = 0; k < len; k++) {
            for (var i = 0; i < channels; i++) {
                output[j++] = data[i][k];
            }
        }
        
        // console.log(output)
        this.emit('data', output);
    }
    
    this.prototype.process = function(elements) {
        var channels = this.config.chanConfig;
        
        // if (channels === 1 && psPresent)
        // TODO: sbrPresent (2)
        var mult = 1;
        
        var len = mult * this.config.frameLength;
        var data = this.data = [];
        
        // Initialize channels
        for (var i = 0; i < channels; i++) {
            data[i] = new Float32Array(len);
        }
        
        var channel = 0;
        for (var i = 0; i < elements.length && channel < channels; i++) {
            var e = elements[i];
            
            if (e instanceof ICStream) { // SCE or LFE element
                channel += this.processSingle(e, channel);
            } else if (e instanceof CPEElement) {
                this.processPair(e, channel);
                channel += 2;
            } else if (e instanceof CCEElement) {
                channel++;
            } else {
                throw new Error("Unknown element found.")
            }
        }
    }
    
    this.prototype.processSingle = function(elemtn, channel) {
        console.log('processSingle')
    }
    
    this.prototype.processPair = function(element, channel) {
        var profile = this.config.profile,
            left = element.left,
            right = element.right,
            l_info = left.info,
            r_info = right.info,
            l_data = left.data,
            r_data = right.data;
            
        // Mid-side stereo
        if (element.commonWindow && element.maskPresent)
            this.processMS(element, l_data, r_data);
            
        if (profile === AOT_AAC_MAIN)
            throw new Error("Main prediction unimplemented");
        
        // Intensity stereo    
        this.processIS(element, l_data, r_data);
            
        if (profile === AOT_AAC_LTP)
            throw new Error("LTP prediction unimplemented");
            
        this.applyChannelCoupling(element, CCEElement.BEFORE_TNS, l_data, r_data);
        
        if (left.tnsPresent)
            left.tns.process(left, l_data, false);
            
        if (right.tnsPresent)
            right.tns.process(right, r_data, false);
        
        this.applyChannelCoupling(element, CCEElement.AFTER_TNS, l_data, r_data);
        
        // filterbank
        this.filter_bank.process(l_info, l_data, this.data[channel], channel);
        this.filter_bank.process(r_info, r_data, this.data[channel + 1], channel + 1);
        
        if (profile === AOT_AAC_LTP)
            throw new Error("LTP prediction unimplemented");
        
        this.applyChannelCoupling(element, CCEElement.AFTER_IMDCT, this.data[channel], this.data[channel + 1]);
        
        if (left.gainPresent)
            throw new Error("Gain control not implemented");
            
        if (right.gainPresent)
            throw new Error("Gain control not implemented");
            
        if (this.sbrPresent)
            throw new Error("SBR not implemented");
    }
    
    // Intensity stereo
    this.prototype.processIS = function(element, left, right) {
        var ics = element.right,
            info = ics.info,
            offsets = info.swbOffsets,
            windowGroups = info.groupCount,
            maxSFB = info.maxSFB,
            bandTypes = ics.bandTypes,
            sectEnd = ics.sectEnd,
            scaleFactors = ics.scaleFactors;
        
        var idx = 0, groupOff = 0;
        for (var g = 0; g < windowGroups; g++) {
            for (var i = 0; i < maxSFB;) {
                var end = sectEnd[idx];
                
                if (bandTypes[idx] === INTENSITY_BT || bandTypes[idx] === INTENSITY_BT2) {
                    for (; i < end; i++, idx++) {
                        var c = bandTypes[idx] === INTENSITY_BT ? 1 : -1;
                        if (element.maskPresent)
                            c *= element.ms_used[idx] ? -1 : 1;
                            
                        var scale = c * scaleFactors[idx];
                        for (var w = 0; w < info.groupLength[g]; w++) {
                            var off = groupOff + w * 128 + offsets[i],
                                len = offsets[i + 1] - offsets[i];
                                
                            for (var j = 0; j < len; j++) {
                                right[off + j] = left[off + j] * scale;
                            }
                        }
                    }
                } else  {
                    idx += end - i;
                    i = end;
                }
            }
            
            groupOff += info.groupLength[g] * 128;
        }
    }
    
    // Mid-side stereo
    this.prototype.processMS = function(element, left, right) {
        var ics = element.left,
            info = ics.info,
            offsets = info.swbOffsets,
            windowGroups = info.groupCount,
            maxSFB = info.maxSFB,
            sfbCBl = ics.bandTypes,
            sfbCBr = element.right.bandTypes;
            
        var groupOff = 0, idx = 0;
        for (var g = 0; g < windowGroups; g++) {
            for (var i = 0; i < maxSFB; i++, idx++) {
                if (element.ms_used[idx] && sfbCBl[idx] < NOISE_BT && sfbCBr[idx] < NOISE_BT) {
                    for (var w = 0; w < info.groupLength[g]; w++) {
                        var off = groupOff + w * 128 + offsets[i];
                        for (var j = 0; j < offsets[i + 1] - offsets[i]; j++) {
                            var t = left[off + j] - right[off + j];
                            left[off + j] += right[off + j];
                            right[off + j] = t;
                        }
                    }
                }
            }
            groupOff += info.groupLength[g] * 128;
        }
    }
    
    this.prototype.applyChannelCoupling = function(element, couplingPoint, data1, data2) {
        var cces = this.cces,
            isChannelPair = element instanceof CPEElement,
            applyCoupling = couplingPoint === CCEElement.AFTER_IMDCT ? 'applyIndependentCoupling' : 'applyDependentCoupling';
        
        for (var i = 0; i < cces.length; i++) {
            var cce = cces[i],
                index = 0;
                
            if (cce.couplingPoint === couplingPoint) {
                for (var c = 0; c < cce.coupledCount; c++) {
                    var chSelect = cce.chSelect[c];
                    if (cce.channelPair[c] === isChannelPair && cce.idSelect[c] === element.id) {
                        if (chSelect !== 1) {
                            cce[applyCoupling](index, data1);
                            if (chSelect) index++;
                        }
                        
                        if (chSelect !== 2)
                            cce[applyCoupling](index++, data2);
                            
                    } else {
                        index += 1 + (chSelect === 3 ? 1 : 0);
                    }
                }
            }
        }
    }
})