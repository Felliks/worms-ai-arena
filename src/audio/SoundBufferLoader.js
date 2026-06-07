// SoundBufferLoader.js
// Loads a list of audio files into Web Audio buffers.
//
// Fault tolerant: a missing (HTTP 4xx/5xx), network-failed or undecodable file
// no longer stalls the whole loader. Each url always resolves to a bufferList
// entry (with buffer === null on failure) and the load count always reaches the
// url count, so the asset loader can finish and the game can start even when an
// asset pack is incomplete.

function BufferLoader(context, urlList, callback) {
  this.context = context;
  this.urlList = urlList;
  this.onload = callback;
  this.bufferList = new Array(urlList.length);
  this.loadCount = 0;
}

BufferLoader.prototype.nameFor = function(url) {
  var match = url.match("[a-z,A-Z,0-9]+[.]");
  return match ? match[0].replace(".", "") : url;
};

BufferLoader.prototype.finish = function(index, entry) {
  this.bufferList[index] = entry;
  if (++this.loadCount === this.urlList.length) {
    this.onload(this.bufferList);
  }
};

BufferLoader.prototype.loadBuffer = function(url, index) {
  // Load buffer asynchronously
  var request = new XMLHttpRequest();
  request.open("GET", url, true);
  request.responseType = "arraybuffer";

  var loader = this;
  var name = loader.nameFor(url);

  request.onload = function() {
    // A 404/500 still fires onload; treat any non-2xx/3xx as a missing asset.
    if (request.status && (request.status < 200 || request.status >= 400)) {
      console.warn("BufferLoader: asset missing (" + request.status + ") " + url);
      loader.finish(index, { buffer: null, name: name });
      return;
    }

    // Asynchronously decode the audio file data in request.response
    loader.context.decodeAudioData(
      request.response,
      function(buffer) {
        if (buffer) {
          console.log(" Audio file " + url + " loaded sucessfully ");
        }
        loader.finish(index, { buffer: buffer || null, name: name });
      },
      function(error) {
        console.warn('BufferLoader: decodeAudioData failed for ' + url);
        loader.finish(index, { buffer: null, name: name });
      }
    );
  }

  request.onerror = function() {
    console.warn('BufferLoader: XHR error ' + url);
    loader.finish(index, { buffer: null, name: name });
  }

  request.send();
}

BufferLoader.prototype.load = function() {
  for (var i = 0; i < this.urlList.length; ++i)
  this.loadBuffer(this.urlList[i], i);
}
