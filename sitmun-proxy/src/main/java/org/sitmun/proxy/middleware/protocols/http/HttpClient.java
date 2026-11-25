package org.sitmun.proxy.middleware.protocols.http;

import java.io.IOException;
import okhttp3.Request;
import okhttp3.Response;

public interface HttpClient {

  Response executeRequest(Request httpRequest) throws IOException;

  default Response executeOnce(Request httpRequest) throws IOException {
    return executeRequest(httpRequest);
  }
}
