export default class PooledObject {
  static getFromPool() {
    let pool = this._pool || (this._pool = []);
    let obj = pool.length ? pool.pop() : new this(...arguments);
    obj.init(...arguments)
    return obj;
  }
  
  init() {}
  release() {
    let pool = this.constructor._pool || (this.constructor._pool = []);
    pool.push(this);
  }
}
