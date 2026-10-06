import { expect } from "chai";
import { corsOptions, isAllowedOrigin } from "../src/config/cors.js";

describe("CORS", () => {
  it("allows login preflight methods and headers", () => {
    expect(corsOptions.methods).to.include("OPTIONS");
    expect(corsOptions.methods).to.include("POST");
    expect(corsOptions.allowedHeaders).to.include("Content-Type");
    expect(corsOptions.allowedHeaders).to.include("Authorization");
    expect(corsOptions.credentials).to.equal(true);
  });

  it("allows frontend origins with ports during development", () => {
    expect(isAllowedOrigin("http://localhost:3001")).to.equal(true);
    expect(isAllowedOrigin("http://127.0.0.1:8081")).to.equal(true);
    expect(isAllowedOrigin("http://192.168.1.25:5173")).to.equal(true);
    expect(isAllowedOrigin("http://10.0.0.8:8081")).to.equal(true);
    expect(isAllowedOrigin("http://172.20.1.10:3000")).to.equal(true);
  });
});
