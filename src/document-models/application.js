'use strict';

const applicationHelper = require('../modules/application-helper');
const randomRange = require('../modules/random-range');

module.exports = async (documentId, dbManager) => {
	const instance = {};

	instance.documentId = documentId;
	instance.dbManager = dbManager;

	instance.isHasPermission = async (permissionName) => {
		const app = await dbManager.findArrayAsync('applications', {_id: documentId})[0];

		if (app == null)
			throw new Error('application not found');

		return permissionName in app.permissions;
	};

	instance.generateApplicationKey = async () => {
		const keyCode = randomRange(1, 99999);
		dbManager.updateAsync('applications', {_id: documentId}, {key_code: keyCode});
		const app = await dbManager.findArrayAsync('applications', {_id: documentId})[0];

		return applicationHelper.buildApplicationKey(app._id, app.creator_id, app.key_code);
	};

	instance.getApplicationKey = async () => {
		const app = await dbManager.findArrayAsync('applications', {_id: documentId})[0];

		if (app == null)
			throw new Error('application not found');

		return applicationHelper.buildApplicationKey(app._id, app.creator_id, app.key_code);
	};

	return instance;
};
