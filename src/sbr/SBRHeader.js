export default class SBRHeader {
  constructor() {
    this.decoded = false;
  }
    
  decode(stream) {
    this.decoded = true;
        
    // save previous values
    this.startFrequencyPrev = this.startFrequency;
    this.stopFrequencyPrev = this.stopFrequency;
    this.frequencyScalePrev = this.frequencyScale;
    this.alterScalePrev = this.alterScale;
    this.xOverBandPrev = this.xOverBand;
    this.noiseBandsPrev = this.noiseBands;
    this.limiterBandsPrev = this.limiterBands;

    // read new values
    this.ampRes = stream.read(1);
    this.startFrequency = stream.read(4);
    this.stopFrequency = stream.read(4);
    this.xOverBand = stream.read(3);
    stream.advance(2); // reserved

    let extraHeader1 = stream.read(1);
    let extraHeader2 = stream.read(1);

    if (extraHeader1) {
      this.frequencyScale = stream.read(2);
      this.alterScale = stream.read(1);
      this.noiseBands = stream.read(2);
    } else {
      this.frequencyScale = 2;
      this.alterScale = 1;
      this.noiseBands = 2;
    }

    if (extraHeader2) {
      this.limiterBands = stream.read(2);
      this.limiterGains = stream.read(2);
      this.interpolFrequency = stream.read(1);
      this.smoothingMode = stream.read(1);
    } else {
      this.limiterBands = 2;
      this.limiterGains = 2;
      this.interpolFrequency = 1;
      this.smoothingMode = 1;
    }

    this.reset = this.startFrequency !== this.startFrequencyPrev
                  || this.stopFrequency !== this.stopFrequencyPrev
                  || this.frequencyScale !== this.frequencyScalePrev
                  || this.alterScale !== this.alterScalePrev
                  || this.xOverBand !== this.xOverBandPrev
                  || this.noiseBands !== this.noiseBandsPrev;
  }
}
