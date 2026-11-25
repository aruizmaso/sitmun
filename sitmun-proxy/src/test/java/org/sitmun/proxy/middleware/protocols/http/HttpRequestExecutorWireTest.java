package org.sitmun.proxy.middleware.protocols.http;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.OkHttpClient;
import org.junit.jupiter.api.Test;

class HttpRequestExecutorWireTest {

  @Test
  void preservesBaseQueryAndSendsLiteralPlusWithOneDecoding() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    AtomicReference<String> received = new AtomicReference<>();
    server.createContext("/wfs", exchange -> {
      received.set(exchange.getRequestURI().getRawQuery());
      exchange.sendResponseHeaders(200, -1);
      exchange.close();
    });
    server.start();
    try {
      String url = "http://127.0.0.1:" + server.getAddress().getPort()
          + "/wfs?workspace=a%2Bb&flag";
      OkHttpClient client = new OkHttpClient();
      HttpRequestExecutor executor = new HttpRequestExecutor(url, request -> client.newCall(request).execute());
      executor.setUrl(url);
      executor.addParameter("outputFormat", "application/gml+xml");
      executor.execute();

      assertThat(received.get()).isEqualTo("workspace=a%2Bb&flag&outputFormat=application/gml%2Bxml");
      assertThat(URLDecoder.decode(received.get(), StandardCharsets.UTF_8))
          .isEqualTo("workspace=a+b&flag&outputFormat=application/gml+xml");
    } finally {
      server.stop(0);
    }
  }
}
