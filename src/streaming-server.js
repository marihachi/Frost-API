'use strict';

const Application = require('./documentModels/application');
const ApplicationAccess = require('./documentModels/applicationAccess');
const Route = require('./helpers/route');
const ioServer = require('socket.io');
const redis = require('redis');
const methods = require('methods');

module.exports = (http, directoryRouter, subscribers, db, config) => {
	const ioServerToClient = ioServer(http);

	const checkConnection = async (clientManager, applicationKey, accessKey) => {
		if (applicationKey == null) {
			clientManager.stream('error:connection', {message: 'applicationKey parameter is empty'});
			return null;
		}

		if (accessKey == null) {
			clientManager.stream('error:connection', {message: 'accessKey parameter is empty'});
			return null;
		}

		if (!await Application.verifyKeyAsync(applicationKey, db, config)) {
			clientManager.stream('error:connection', {message: 'applicationKey parameter is invalid'});
			return null;
		}

		if (!await ApplicationAccess.verifyKeyAsync(accessKey, db, config)) {
			clientManager.stream('error:connection', {message: 'accessKey parameter is invalid'});
			return null;
		}

		return {
			applicationId: Application.splitKey(applicationKey, db, config).applicationId,
			userId: ApplicationAccess.splitKey(accessKey, db, config).userId
		};
	};

	const timelineTypes = ['public', 'home'];

	ioServerToClient.sockets.on('connection', ioServerToClientSocket => {
		(async () => {
			const clientManager = new (require('./helpers/server-streaming-manager'))(ioServerToClient, ioServerToClientSocket, {});

			const applicationKey = ioServerToClientSocket.handshake.query.applicationKey;
			const accessKey = ioServerToClientSocket.handshake.query.accessKey;
			const checkResult = await checkConnection(clientManager, applicationKey, accessKey);
			if (checkResult == null) {
				return clientManager.disconnect();
			}
			const userId = checkResult.userId;
			const applicationId = checkResult.applicationId;

			ioServerToClientSocket.application = (await db.applications.findByIdAsync(applicationId));
			ioServerToClientSocket.user = (await db.users.findByIdAsync(userId));

			// クライアント側からRESTリクエストを受信したとき
			clientManager.on('rest', data => {
				(async () => {
					if (data.request.method == null || data.request.endpoint == null) {
						return clientManager.stream('error:rest', {message: 'request format is invalid'});
					}

					if (data.request.endpoint.indexOf('..') != -1)
						return clientManager.stream('error:rest', {message: '\'endpoint\' parameter is invalid'});

					const method = methods.find(i => i.toLowerCase() === data.request.method.toLowerCase()).toLowerCase();

					if (method == null)
						return clientManager.stream('error:rest', {message: '\'method\' parameter is invalid'});

					let routeFuncAsync;
					try {
						const route = directoryRouter.findRoute(data.request.method, data.request.endpoint);
						routeFuncAsync = (require(route.getMoludePath()))[method];
					}
					catch(e) {
						console.log('error: faild to parse route info');
						console.log('reason: ' + e);
					}

					if (routeFuncAsync == null)
						return clientManager.stream('error:rest', {message: '\'endpoint\' parameter is invalid'});

					const req = {
						method: data.request.method,
						endpoint: data.request.endpoint,
						query: data.request.query,
						headers: data.request.headers,
						body: data.request.body,
						db: db,
						config: config,
						user: ioServerToClientSocket.user,
						application: ioServerToClientSocket.application
					};

					require('./helpers/middlewares/checkRequest')(req);

					const apiResult = await routeFuncAsync(req);

					let sendData = {};

					if (apiResult.statusCode == null)
						apiResult.statusCode = 200;

					if (typeof apiResult.data == 'string')
						sendData.message = apiResult.data;
					else if (apiResult.data != null)
						sendData = apiResult.data;

					if (apiResult.statusCode >= 400)
						return clientManager.rest(data.request, false, sendData);

					return clientManager.rest(data.request, true, sendData);
				})();
			});

			let publicSubscriber = null;
			let homeSubscriber = null;

			// クライアント側からタイムラインの購読リクエストを受信したとき
			clientManager.on('timeline-connect', data => {
				const timelineType = data.type;

				if (timelineType == null)
					return clientManager.stream('error:timeline-connect', {message: '\'type\' parameter is require'});

				if (!timelineTypes.some(i => i == timelineType))
					return clientManager.stream('error:timeline-connect', {message: '\'type\' parameter is invalid'});

				// Redis: 購読状態の初期化
				if (timelineType == timelineTypes[0]) { // public
					if (publicSubscriber != null)
						return clientManager.stream('error:timeline-connect', {message: 'public timeline is already subscribed'});

					publicSubscriber = redis.createClient(6379, 'localhost');
					publicSubscriber.subscribe('public:status'); // パブリックを購読
					publicSubscriber.on('message', (ch, jsonData) => {
						const chInfo = ch.split(':');
						const dataType = chInfo[1];

						clientManager.data(`public:${dataType}`, JSON.parse(jsonData));
					});
					publicSubscriber.on('error', function(err) {
						console.log('redis_err(publicSubscriber): ' + String(err));
					});

					clientManager.stream('success:timeline-connect', {message: 'connected public timeline'});
				}

				if (timelineType == timelineTypes[1]) { // home
					if (homeSubscriber != null)
						return clientManager.stream('error:timeline-connect', {message: 'home timeline is already subscribed'});

					homeSubscriber = redis.createClient(6379, 'localhost');
					subscribers.set(userId.toString(), homeSubscriber);
					homeSubscriber.subscribe(`${userId.toString()}:status`); // 自身を購読
					// subscriber.subscribe(`status:${}`); // TODO: フォローしている全ユーザーを購読
					homeSubscriber.on('message', (ch, jsonData) => {
						const chInfo = ch.split(':');
						const dataType = chInfo[1];

						clientManager.data(`home:${dataType}`, JSON.parse(jsonData));
					});
					homeSubscriber.on('error', function(err) {
						console.log('redis_err(homeSubscriber): ' + String(err));
					});

					clientManager.stream('success:timeline-connect', {message: 'connected home timeline'});
				}
			});

			clientManager.on('timeline-disconnect', data => {
				const timelineType = data.type;

				if (timelineType == null)
					return clientManager.stream('error:timeline-disconnect', {message: '\'type\' parameter is require'});

				if (!timelineTypes.some(i => i == timelineType))
					return clientManager.stream('error:timeline-disconnect', {message: '\'type\' parameter is invalid'});

				if (timelineType == timelineTypes[0]) {
					if (homeSubscriber != null)
						return clientManager.stream('error:timeline-disconnect', {message: 'public timeline is not subscribed'});

					publicSubscriber.quit([], () => {
						publicSubscriber = null;
						clientManager.stream('success:timeline-disconnect', {message: 'disconnected public timeline'});
					});
				}

				if (timelineType == timelineTypes[1]) {
					if (homeSubscriber != null)
						return clientManager.stream('error:timeline-disconnect', {message: 'home timeline is not subscribed'});

					homeSubscriber.quit([], () => {
						homeSubscriber = null;
						clientManager.stream('success:timeline-disconnect', {message: 'disconnected home timeline'});
					});
				}
			});

			clientManager.onDisconnect((err, res) => {
				if (homeSubscriber != null) {
					homeSubscriber.quit(() => {
						homeSubscriber = null;
					});
				}
				if (publicSubscriber != null) {
					publicSubscriber.quit((err, res) => {
						publicSubscriber = null;
					});
				}
			});
		})();
	});
};
