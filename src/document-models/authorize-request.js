'use strict';

const authorizeRequestHelper = require('../modules/authorize-request-helper');
const randomRange = require('../modules/random-range');

module.exports = async (documentId, dbManager) => {
	const instance = {};

	instance.documentId = documentId;
	instance.dbManager = dbManager;

	instance.generatePinCode = async () => {
		var pinCode = "";
		for (var i = 0; i < 6; i++)
			pinCode += String(randomRange(0, 9));

		dbManager.updateAsync('authorizeRequests', {_id: documentId}, {pin_code: pinCode});

		return pinCode;
	};

	instance.generateRequestKey = async () => {
		const keyCode = randomRange(1, 99999);
		dbManager.updateAsync('authorizeRequests', {_id: documentId}, {key_code: keyCode});
		const request = await dbManager.findArrayAsync('authorizeRequests', {_id: documentId})[0];

		return authorizeRequestHelper.buildRequestKey(request._id, request.application_id, request.key_code);
	};

	instance.getRequestKey = async () => {
		const request = await dbManager.findArrayAsync('authorizeRequests', {_id: documentId})[0];

		if (request == undefined)
			throw new Error('authorize-request not found');

		return authorizeRequestHelper.buildRequestKey(request._id, request.application_id, request.key_code);
	};

	return instance;
};
