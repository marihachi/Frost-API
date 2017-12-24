const ApiContext = require('./ApiContext');
const { ApiError } = require('./errors');
const pathToRegexp = require('path-to-regexp');

class DirectoryRouter {
	/**
	 * このモジュールを初期化します
	 *
	 * @param  {e} app 対象のサーバアプリケーション
	 * @param  {Object} db 対象のDB
	 * @param  {[]} config 対象のconfig
	 */
	constructor(app) {
		if (app == null) {
			throw new Error('missing arguments');
		}

		this.app = app;
		this.routes = [];
	}

	/**
	 * ルートを追加します
	 *
	 * @param  {Route} route
	 * @return {void}
	 */
	addRoute(route) {
		if (route == null) {
			throw new Error('missing arguments');
		}

		this.app[route.method](route.path, (request, response) => {
			(async () => {
				request.version = request.params.ver;

				const apiContext = new ApiContext(request.streams, request.lock, request.db, request.config, {
					params: request.params,
					query: request.query,
					body: request.body,
					headers: request.headers
				});

				try {
					let routeFuncAsync;

					try {
						routeFuncAsync = require(route.getModulePath())[route.method];
					}
					catch (err) {
						console.log('route error:', err);
					}

					if (routeFuncAsync == null) {
						throw new Error(`route function is not found\ntarget: ${route.method} ${route.path}`);
					}

					await routeFuncAsync(apiContext);
					console.log(`rest: ${route.method.toUpperCase()} ${route.path}, status=${apiContext.statusCode}`);
					response.apiSend(apiContext);
				}
				catch (err) {
					if (err instanceof ApiError) {
						console.log(`rest: ${route.method.toUpperCase()} ${route.path}, status=${err.statusCode}`);
						response.apiSend(apiContext.response(err.statusCode, err.message));
					}
					else if (err instanceof Error) {
						console.log('Internal Error:', err);
						apiContext.response(500, { message: 'internal error', details: err });
						response.apiSend(apiContext);
					}
					else {
						console.log('Internal Error(unknown type):', err);
						apiContext.response(500, { message: 'internal error(unknown type)', details: err });
						response.apiSend(apiContext);
					}
				}
			})();
		});

		this.routes.push(route);
	}

	/**
	 * 該当するルートを取得します
	 *
	 * @param  {string} method
	 * @param  {string} endpoint
	 * @return {Object} Route instance
	 */
	findRoute(method, endpoint) {
		if (method == null || endpoint == null) {
			throw new Error('missing arguments');
		}

		if (typeof method != 'string' || typeof endpoint != 'string') {
			throw new Error('invalid type');
		}

		return this.routes.find(i => i.method === method.toLowerCase() && pathToRegexp(i.path, []).test(endpoint));
	}
}
module.exports = DirectoryRouter;
