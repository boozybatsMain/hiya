// Стабы Firestore/RTDB для юнит-тестов обоих обработчиков.
function makeStubs(initialCount) {
  const state = { count: initialCount, docs: {}, recent: [] };
  const fs = {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({
          exists: !!state.docs[id],
          get: (f) => (state.docs[id] || {})[f],
          data: () => state.docs[id],
        }),
        create: async (data) => {
          if (state.docs[id]) { const e = new Error('exists'); e.code = 6; throw e; }
          state.docs[id] = data;
        },
        set: async (data) => {
          state.docs[id] = Object.assign({}, state.docs[id], data);
        },
        delete: async () => { delete state.docs[id]; },
      }),
    }),
  };
  const rtdb = {
    ref: (path) => ({
      transaction: async (fn) => {
        state.count = fn(state.count);
        return { snapshot: { val: () => state.count } };
      },
      push: async (v) => { state.recent.push(v); },
    }),
  };
  return { deps: { fs, rtdb, now: () => 1000 }, state };
}
module.exports = { makeStubs };
