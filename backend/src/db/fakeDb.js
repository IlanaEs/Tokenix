// fakeDb.js

export const db = {
  users: [],
  wallets: [],
  transactions: []
};

// Helpers

export const findUserByEmail = (email) =>
  db.users.find(u => u.email === email);

export const findUserById = (id) =>
  db.users.find(u => u.userId === id);

export const saveUser = (user) => {
  db.users.push(user);
  return user;
};

export const saveWallet = (wallet) => {
  db.wallets.push(wallet);
  return wallet;
};

export const findWalletByUserId = (userId) =>
  db.wallets.find(w => w.userId === userId);

export const saveTransaction = (tx) => {
  db.transactions.push(tx);
  return tx;
};
