/*
 * Copyright 2011-2012 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var vertx = require('vertx');
var fs = require('vertx/file_system');
var vertxTest = require('vertx_tests');
var vassert = vertxTest.vassert;

var tu = require('test_utils');

var port = 8080;
var server = vertx.http.createHttpServer();
var client = vertx.http.createHttpClient().port(port);
var print  = require('vertx/console').log;

var httpTest = {

  testServerCompressionSupportedProperty: function() {
    vassert.assertTrue("HTTP server should default to no compression", !server.compressionSupported());
    vassert.assertEquals(server, server.compressionSupported(true));
    vassert.assertTrue("HTTP server should support compression", server.compressionSupported());
    vassert.testComplete();
  },

  testClientTryCompressionProperty: function() {
    vassert.assertTrue("HTTP client should default to no compression", !client.tryUseCompression());
    vassert.assertEquals(client, client.tryUseCompression(true));
    vassert.assertTrue("HTTP client should support compression", client.tryUseCompression());
    vassert.testComplete();
  },

  testMaxWebsocketFrameSizeServer: function() {
    var size = 61231762;
    vassert.assertTrue(65536 === server.maxWebSocketFrameSize());
    vassert.assertEquals(server, server.maxWebSocketFrameSize(size));
    vassert.assertTrue(size === server.maxWebSocketFrameSize());
    vassert.testComplete();
  },

  testMaxWebsocketFrameSizeClient: function() {
    var size = 61231762;
    vassert.assertTrue(65536 === client.maxWebSocketFrameSize());
    vassert.assertEquals(client, client.maxWebSocketFrameSize(size));
    vassert.assertTrue(size === client.maxWebSocketFrameSize());
    vassert.testComplete();
  },

  testHttpServerLocalRemoteAddress: function() {
    server.requestHandler(function(req) {

      var local = req.localAddress();
      vassert.assertTrue(local.getPort() > 0);
      vassert.assertTrue(local.getHostString() !== null);

      var remote = req.remoteAddress();
      vassert.assertTrue(remote.getPort() > 0);
      vassert.assertTrue(remote.getHostString() !== null);
      vassert.assertTrue(remote.port === remote.getPort());
      vassert.assertTrue(remote.address === remote.getHostString());

      vassert.testComplete();
    });
    server.listen(8080, "0.0.0.0", function(err, serv) {
      vassert.assertTrue("Unexpected error: " + err, err === null);
      client.port(8080);
      client.get("/foo").end();
    });
  },

  testRequestTimeout: function() {
    server.requestHandler(function(req) {
      req.pause();
      req.response.end("OK");
    });
    server.listen(8080, "0.0.0.0", function(err, serv) {
      vassert.assertTrue("Unexpected error: " + err, err === null);
      client.port(8080);
      var req = client.get("/foo", function(resp) {
      });
      req.exceptionHandler(function(e) {
        // expected on timeout
        vassert.testComplete();
      });
      vassert.assertTrue(req === req.timeout(1));
      req.end();
    });
  },

  testFormFileUpload: function() {
    var content = "Vert.x rocks!";
    server.requestHandler(function(req) {
      if (req.uri() === '/form') {
        req.expectMultiPart(true);
        req.response.chunked(true);
        req.uploadHandler(function(upload) {
          vassert.assertTrue(upload.filename() === "tmp-0.txt");
          vassert.assertTrue(upload.contentType() === "image/gif");
          upload.dataHandler(function(buffer) {
            vassert.assertEquals(content, buffer.toString());
          });
        });
        req.endHandler(function() {
          var attrs = req.formAttributes();
          vassert.assertTrue(attrs.isEmpty());
          req.response.end();
        });
      }
    });
    server.listen(8080, "0.0.0.0", function(err, serv) {
      vassert.assertTrue(err === null);
      client.port(8080);
      var req = client.post("/form", function(resp) {
        // assert the response
        vassert.assertTrue(200 === resp.statusCode());
        resp.bodyHandler(function(body) {
          vassert.assertTrue(0 === body.length());
        });
        vassert.testComplete();
      });

      var boundary = "dLV9Wyq26L_-JQxk6ferf-RT153LhOO";
      var buffer = new vertx.Buffer();
      var b =
          "--" + boundary + "\r\n" +
          "Content-Disposition: form-data; name=\"file\"; filename=\"tmp-0.txt\"\r\n" +
          "Content-Type: image/gif\r\n" +
          "\r\n" +
          content + "\r\n" +
          "--" + boundary + "--\r\n";

      buffer.appendString(b);
      req.headers().set("content-length", '' + buffer.length());
      req.headers().set("content-type", "multipart/form-data; boundary=" + boundary);
      req.write(buffer).end();
    });
  },

  testFormUploadAttributes: function() {
      var content = "Vert.x rocks!";
      server.requestHandler(function(req) {

          if (req.uri() === '/form') {
              req.response.chunked(true);
              req.expectMultiPart(true);
              req.uploadHandler(function(event) {
                  event.dataHandler(function(buffer) {
                      vassert.fail("Data handler should not be called");
                  });
              });
              req.endHandler(function() {
                  var attrs = req.formAttributes();
                  vassert.assertEquals(attrs.get('framework'), "vertx");
                  vassert.assertEquals(attrs.get('runson'), "jvm");
                  req.response.end();
              });
          }
      });
      server.listen(8080, "0.0.0.0", function(err, serv) {
          vassert.assertTrue(err === null);
          client.port(8080);
          var req = client.post("/form", function(resp) {
              // assert the response
              vassert.assertTrue(200 === resp.statusCode());
              resp.bodyHandler(function(body) {
                  vassert.assertTrue(0 === body.length());
              });
              vassert.testComplete();
          });

          var buffer = new vertx.Buffer();
          buffer.appendString("framework=vertx&runson=jvm");
          req.headers().set("content-length", '' + buffer.length());
          req.headers().set("content-type", "application/x-www-form-urlencoded");
          req.write(buffer).end();
      });
  },

  testSendFile: function() {
    var content = tu.randomUnicodeString(10000);
    var fileName = './test-send-file.html';
    setupFile(fileName, content);
    server.requestHandler(function(req) {
      req.response.sendFile(fileName);
    });
    server.listen(8080, "0.0.0.0", function(err, srv) {
      vassert.assertTrue(err === null);
      client.port(8080);
      var req = client.getNow("/some/path", function(resp) {
        vassert.assertTrue(200 === resp.statusCode());
        vassert.assertTrue('text/html' === resp.headers().get('content-type'));
        resp.bodyHandler(function(body) {
            vassert.assertTrue(tu.buffersEqual(new vertx.Buffer(content), body));
            fs.deleteSync(fileName);
            vassert.testComplete();
        });
      });
    });
  },

  testSendFileWithHandler: function() {
    var content = tu.randomUnicodeString(10000);
    var fileName = './test-send-file.html';
    setupFile(fileName, content);

    server.requestHandler(function(req) {
      req.response.sendFile(fileName, function(err) {
        vassert.assertTrue(err === null);
      });
    });

    server.listen(8080, "0.0.0.0", function(err, srv) {
      vassert.assertTrue(err === null);
      client.port(8080);
      var req = client.getNow("/some/path", function(resp) {
        vassert.assertTrue(200 === resp.statusCode());
        vassert.assertTrue('text/html' === resp.headers().get('content-type'));
        resp.bodyHandler(function(body) {
            vassert.assertTrue(tu.buffersEqual(new vertx.Buffer(content), body));
            fs.deleteSync(fileName);
            vassert.testComplete();
        });
      });
    });
  },

  testSendFileNotFound: function() {
    var content = tu.randomUnicodeString(10000);
    var fileName = './404.html';
    setupFile(fileName, content);

    server.requestHandler(function(req) {
      req.response.sendFile('doesnotexist.html', fileName);
    });

    server.listen(8080, "0.0.0.0", function(err, srv) {
      vassert.assertTrue(err === null);
      client.port(8080);
      var req = client.getNow("/some/path", function(resp) {
        vassert.assertTrue(404 === resp.statusCode());
        vassert.assertTrue('text/html' === resp.headers().get('content-type'));
        resp.bodyHandler(function(body) {
            vassert.assertTrue(tu.buffersEqual(new vertx.Buffer(content), body));
            fs.deleteSync(fileName);
            vassert.testComplete();
        });
      });
    });
  },

  testSendFileNotFoundWithHandler: function() {
    var content = tu.randomUnicodeString(10000);
    var fileName = './404.html';
    setupFile(fileName, content);

    server.requestHandler(function(req) {
      req.response.sendFile('doesnotexist.html', fileName, function(err) {
        vassert.assertTrue(err === null);
        fs.deleteSync(fileName);
        vassert.testComplete();
      });
    });

    server.listen(8080, "0.0.0.0", function(err, srv) {
      vassert.assertTrue(err === null);
      client.port(8080);
      var req = client.getNow("/some/path", function(resp) {
        vassert.assertTrue(404 === resp.statusCode());
        vassert.assertTrue('text/html' === resp.headers().get('content-type'));
        resp.bodyHandler(function(body) {
            vassert.assertTrue(tu.buffersEqual(new vertx.Buffer(content), body));
        });
      });
    });
  },

  testGET: function() {
    httpMethod(false, "GET", false);
  },

  testGetSSL: function() {
    httpMethod(true, "GET", false);
  },

  testPUT: function() {
    httpMethod(false, "PUT", false);
  },

  testPUTSSL: function() {
    httpMethod(true, "PUT", false);
  },

  testPOST: function() {
    httpMethod(false, "POST", false);
  },

  testPOSTSSL: function() {
    httpMethod(true, "POST", false);
  },

  testHEAD: function() {
    httpMethod(false, "HEAD", false);
  },

  testHEADSSL: function() {
    httpMethod(true, "HEAD", false);
  },

  testOPTIONS: function() {
    httpMethod(false, "OPTIONS", false);
  },

  testOPTIONSSSL: function() {
    httpMethod(true, "OPTIONS", false);
  },

  testDELETE: function() {
    httpMethod(false, "DELETE", false);
  },

  testDELETESSL: function() {
    httpMethod(true, "DELETE", false);
  },

  testTRACE: function() {
    httpMethod(false, "TRACE", false);
  },

  testTRACESSL: function() {
    httpMethod(true, "TRACE", false);
  },

  testCONNECT: function() {
    httpMethod(false, "CONNECT", false);
  },

  testCONNECTSSL: function() {
    httpMethod(true, "CONNECT", false);
  },

  testPATCH: function() {
    httpMethod(false, "PATCH", false);
  },

  testPATCHSSL: function() {
    httpMethod(true, "PATCH", false);
  },

  testGETChunked: function() {
    httpMethod(false, "GET", true);
  },

  testGetSSLChunked: function() {
    httpMethod(true, "GET", true);
  },

  testPUTChunked: function() {
    httpMethod(false, "PUT", true);
  },

  testPUTSSLChunked: function() {
    httpMethod(true, "PUT", true);
  },

  testPOSTChunked: function() {
    httpMethod(false, "POST", true);
  },

  testPOSTSSLChunked: function() {
    httpMethod(true, "POST", true);
  },

  testHEADChunked: function() {
    httpMethod(false, "HEAD", true);
  },

  testHEADSSLChunked: function() {
    httpMethod(true, "HEAD", true);
  },

  testOPTIONSChunked: function() {
    httpMethod(false, "OPTIONS", true);
  },

  testOPTIONSSSLChunked: function() {
    httpMethod(true, "OPTIONS", true);
  },

  testDELETEChunked: function() {
    httpMethod(false, "DELETE", true);
  },

  testDELETESSLChunked: function() {
    httpMethod(true, "DELETE", true);
  },

  testTRACEChunked: function() {
    httpMethod(false, "TRACE", true);
  },

  testTRACESSLChunked: function() {
    httpMethod(true, "TRACE", true);
  },

  testCONNECTChunked: function() {
    httpMethod(false, "CONNECT", true);
  },

  testCONNECTSSLChunked: function() {
    httpMethod(true, "CONNECT", true);
  },

  testPATCHChunked: function() {
    httpMethod(false, "PATCH", true);
  },

  testPATCHSSLChunked: function() {
    httpMethod(true, "PATCH", true);
  }
};

function setupFile(fileName, content) {
  if (fs.existsSync(fileName)) {
    fs.deleteSync(fileName);
  }
  fs.createFileSync(fileName);
  fs.writeFileSync(fileName, content);
}

function httpMethod(ssl, method, chunked) {

  if (ssl) {
    server.ssl(true);
    server.keyStorePath('./src/test/keystores/server-keystore.jks');
    server.keyStorePassword('wibble');
    server.trustStorePath('./src/test/keystores/server-truststore.jks');
    server.trustStorePassword('wibble');
    server.clientAuthRequired(true);
  }

  var path = "/someurl/blah.html";
  var query = "param1=vparam1&param2=vparam2";
  var uri = (ssl ? "https" : "http") +"://localhost:" + port + path + "?" + query;

  var statusCode = 200;
  var statusMessage = 'gerbils';

  server.requestHandler(function(req) {
    vassert.assertTrue(req.version() == 'HTTP_1_1');
    vassert.assertTrue(req.method() == method);
    vassert.assertTrue(uri == req.uri());
    vassert.assertTrue(req.path() == path);
    vassert.assertTrue(req.query() == query);

    var headers = req.headers();
    var params  = req.params();

    vassert.assertEquals(headers.get('header1'), 'vheader1');
    vassert.assertEquals(headers.get('header2'), 'vheader2');

    vassert.assertTrue(headers.contains('header1'));
    vassert.assertTrue(headers.contains('header2'));
    vassert.assertTrue(headers.contains('header3'));

    vassert.assertTrue(!headers.isEmpty());

    vassert.assertEquals(params.get('param1'), 'vparam1');
    vassert.assertEquals(params.get('param2'), 'vparam2');

    headers.remove('header3');
    vassert.assertTrue(!headers.contains('header3'));

    req.response.headers().set('rheader1',  'vrheader1');
    req.response.putHeader('rheader2', 'vrheader2');
    if (method !== 'CONNECT') {
      req.response.statusCode(statusCode);
    }
    req.response.statusMessage(statusMessage);
    var body = new vertx.Buffer(0);
    req.dataHandler(function(data) {
      body.appendBuffer(data);
    });
    if (method !== 'HEAD' && method !== 'CONNECT') {
      req.response.chunked(chunked);
    }
    req.endHandler(function() {
      if (!chunked) {
        req.response.headers().set('Content-Length',  '' + body.length());
      }
      if (method !== 'HEAD' && method !== 'CONNECT') {
        req.response.write(body);
        if (chunked) {
          req.response.trailers().set('trailer1', 'vtrailer1');
          req.response.putTrailer('trailer2', 'vtrailer2');
        }
      }
      req.response.end();
    });
  });
  server.listen(port, "0.0.0.0", function(err, serv) {
    vassert.assertTrue(err === null);
    if (ssl) {
      client.ssl(true);
      client.keyStorePath('./src/test/keystores/client-keystore.jks');
      client.keyStorePassword('wibble');
      client.trustStorePath('./src/test/keystores/client-truststore.jks');
      client.trustStorePassword('wibble');
    }

    var sent_buff = tu.generateRandomBuffer(1000);

    var request = client.request(method, uri, function(resp) {
      vassert.assertTrue(200 === resp.statusCode());
      vassert.assertTrue('vrheader1' === resp.headers().get('rheader1'));
      vassert.assertTrue('vrheader2' === resp.headers().get('rheader2'));
      var body = new vertx.Buffer(0);
      resp.dataHandler(function(data) {
        body.appendBuffer(data);
      });

      resp.endHandler(function() {
        if (method !== 'HEAD' && method !== 'CONNECT') {
          vassert.assertTrue(tu.buffersEqual(sent_buff, body));
          if (chunked) {
            vassert.assertTrue('vtrailer1' === resp.trailers().get('trailer1'));
            vassert.assertTrue('vtrailer2' === resp.trailers().get('trailer2'));
          }
        }
        resp.headers().clear();
        vassert.assertTrue(resp.headers().isEmpty());
        vassert.testComplete();
      });
    });

    request.chunked(chunked);
    request.putHeader('header1', 'vheader1');
    request.headers().set('header2', 'vheader2');
    if (!chunked) {
      request.putHeader('Content-Length', '' + sent_buff.length());
    }
 
    request.headers().add('header3', 'vheader3_1').add('header3', 'vheader3');
    var headers = request.headers();
    var size = headers.size();
    var names = headers.names();
    var names_count = 0;
    vassert.assertTrue(size == names.length);

    headers.forEach(function(k, v) {
      vassert.assertTrue(request.headers().getAll(k).indexOf(v) > -1);
    });

    request.write(sent_buff);

    request.end();
  });
}

vertxTest.startTests(httpTest);

function vertxStop() {
  client.close();
  server.close();
}

