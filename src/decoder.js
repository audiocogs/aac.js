//import "ics.js"

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
        
        // WFT is AAC_INIT_VLC_STATIC
        // ff_aac_sbr_init (aacsbr.c:89)
        // dsputil_init (dsputil.c:2833)
        // ff_fmt_convert_init (fmtconvert.c:78)
        
        // ff_aac_tableinit (aac_tablegen.h:35)
        // INIT_VLC_STATIC (get_bits.h:436)
        // ff_mdct_init (mdct.c:43)
        // ff_kbd_window_init (kbdwin.c:26)
        // ff_init_ff_sine_windows (sinewin_tablegen.h:58)
        
        // cbrt_tableinit (cbrt_tablegen.h:35)
        
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
    
    // line 2139    
    this.prototype.readChunk = function() {
        var stream = this.bitstream;
        
        if (!stream.available(1))
            return this.once('available', this.readChunk);
            
        if (stream.peek(12) === 0xfff) {
            this.emit('error', 'adts header')
        }
        
        var elementType;
        while ((elementType = stream.readSmall(3)) !== END_ELEMENT) {
            var elementId = stream.readSmall(4);
            
            switch (elementType) {
                case SCE_ELEMENT:
                case LFE_ELEMENT:
                    console.log('sce or lfe')
                    this.decodeICS(false);
                    break;
                    
                case CPE_ELEMENT:
                    console.log('cpe')
                    break;
                    
                case CCE_ELEMENT:
                    console.log('cce')
                    break;
                    
                case DSE_ELEMENT:
                    console.log('dse')
                    break;
                    
                case PCE_ELEMENT:
                    console.log('pce')
                    break;
                    
                case FIL_ELEMENT:
                    console.log('fil')
                    
                    if (elementId === 15)
                        elementId += stream.read(8) - 1;
                        
                    // decode_extension_payload
                    
                    break;
                    
                default:
                    return this.emit('error', 'Unknown element')
            }
        }
    }
    
    this.prototype.decodeICS = function(commonWindow) {
        new ICS(this.config.frameLength).decode(this.bitstream, this.config, commonWindow);
    }
})