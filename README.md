AAC.js: A JavaScript AAC Decoder
================================

Advanced Audio Coding (AAC) is a standardized, high quality lossy audio codec, designed as the successor to the MP3 format.  AAC is now
one of the most widely deployed audio codecs, and such names as the iTunes Store distribute music in the AAC format.

AAC can be played in a limited number of browsers using the HTML5 audio element, however, some browsers do not support the codec 
for various reasons.  AAC.js enables playback and other decoding tasks in all browsers using the 
[Aurora.js](https://github.com/ofmlabs/aurora.js) audio framework.

AAC.js is based on the prior work of many open source projects, including [JAAD](http://jaadec.sourceforge.net), 
[FAAD](http://www.audiocoding.com/faad2.html), [FFMpeg](http://ffmpeg.org/), and [Helix Datatype](https://datatype.helixcommunity.org).

## Demo

You can check out a [demo](http://labs.official.fm/codecs/aac/) alongside our other decoders 
[jsmad](http://github.com/ofmlabs/jsmad) (MP3), [flac.js](https://github.com/ofmlabs/flac.js), and 
[alac.js](http://github.com/ofmlabs/alac.js).  Currently flac.js works properly in the latest versions of Firefox 
and Chrome, as well as Safari 6 beta.

## Authors

AAC.js was written by [@devongovett](http://github.com/devongovett) of [Official.fm Labs](http://ofmlabs.org/).

## Building

The [import](https://github.com/devongovett/import) module is used to build AAC.js.  You can run
the development server by first installing `import` with npm, and then running it like this:

    sudo npm install import -g
    import aac.js -p 3030

You can also build a static version like this:

    import aac.js build.js

Once it is running on port 3030, you can open test.html and select an AAC file from your system to play back.

## Features

AAC.js supports the AAC Low Complexity Profile, which is the most common profile.  Support for the Main, High Efficiency 
(Spectral Band Replication) and High Efficiency v2 (Spectral Band Replication + Parametric Stereo) profiles is planned.
Other profiles, such as the low delay, and error resilient profiles are not supported, but we'd love pull requests if you feel
motivated to implement them! :)

## License

AAC.js is licensed under the LGPL.

    AAC.js is free software; you can redistribute it and/or modify it 
    under the terms of the GNU Lesser General Public License as 
    published by the Free Software Foundation; either version 3 of the 
    License, or (at your option) any later version.
    
    AAC.js is distributed in the hope that it will be useful, but WITHOUT 
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY 
    or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General 
    Public License for more details.