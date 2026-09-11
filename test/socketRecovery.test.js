import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the shared service without requiring the React Native runtime.
for (const project of ['chatbot-app', 'chatbot-frontend']) {
  describe(`${project} shared socket recovery`, () => {
    it('preserves mounted screen listeners and refreshes auth when disconnected', async () => {
      const source = readFileSync(new URL(`../../${project}/src/services/socketService.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace(/export const socketService = /, 'const socketService = ')
        .replace(/export default socketService;/, 'globalThis.service = socketService;');
      const context = vm.createContext({
        AsyncStorage: { getItem: async () => 'fresh-token' },
        localStorage: { getItem: () => 'fresh-token' },
      });
      vm.runInContext(source, context);
      const listeners = new Set(['presence-update', 'appointment-updated']);
      let connections = 0;
      const socket = { connected: false, connect: () => { connections++; }, listeners };
      context.service._socket = socket;
      const result = await context.service.connect();
      expect(result).to.equal(socket);
      expect(result.auth.token).to.equal('fresh-token');
      expect([...result.listeners]).to.deep.equal(['presence-update', 'appointment-updated']);
      expect(connections).to.equal(1);
    });
  });
}
