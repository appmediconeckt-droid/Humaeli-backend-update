import { expect } from "chai";
import { corsOptions, httpCorsOptions, isAllowedOrigin } from "../src/config/cors.js";

describe("CORS", () => {
  it('allows the backend own origin for same-origin LED PATCH requests', () => {
    const req = { get(name) { return { Origin: 'https://example.railway.app', Host: 'example.railway.app' }[name]; } };
    httpCorsOptions(req, (error, options) => { expect(error).to.equal(null); expect(options.origin).to.equal(true); });
  });
  it('does not allow unrelated hosted origins by matching a suffix', () => {
    const req = { get(name) { return { Origin: 'https://attacker.example', Host: 'example.railway.app' }[name]; } };
    httpCorsOptions(req, (error, options) => {
      expect(error).to.equal(null);
      options.origin('https://attacker.example', (originError, allowed) => { expect(originError).to.be.instanceOf(Error); expect(allowed).to.equal(false); });
    });
  });

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
