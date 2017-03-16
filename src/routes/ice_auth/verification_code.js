'use strict';

const apiResult = require('../../helpers/apiResult');
const authorizeRequestsModelAsync = require('../../models/authorizeRequest');

exports.get = async (request, extensions, db, config) => {
	const iceAuthKey = request.body.ice_auth_key;

	const authorizeRequestsModel = await authorizeRequestsModelAsync(db, config);
	if (!await authorizeRequestsModel.verifyKeyAsync(iceAuthKey))
		return apiResult(400, 'ice_auth_key is invalid');

	const authorizeRequestId = authorizeRequestsModel.splitKey(iceAuthKey).authorizeRequestId;
	const doc = await db.authorizeRequests.findAsync({_id: authorizeRequestId});

	return apiResult(200, 'success', {'verification_code': doc.document.verificationCode});
};
