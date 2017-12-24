const User = require('../../../../documentModels/user');
const UserFollowing = require('../../../../documentModels/userFollowing');
const { StreamUtil } = require('../../../../helpers/stream');
// const $ = require('cafy').default;
const { ApiError } = require('../../../../helpers/errors');

exports.get = async (apiContext) => {
	await apiContext.check({
		query: {},
		permissions: ['userRead']
	});

	// source user
	const sourceUser = await User.findByIdAsync(apiContext.params.id, apiContext.db, apiContext.config);
	if (sourceUser == null) {
		throw new ApiError(404, 'source user as premise not found');
	}

	// target user
	const targetUser = await User.findByIdAsync(apiContext.params.target_id, apiContext.db, apiContext.config);
	if (targetUser == null) {
		throw new ApiError(404, 'target user as premise not found');
	}

	if (sourceUser.document._id.equals(targetUser.document._id)) {
		throw new ApiError(400, 'source user and target user is same');
	}

	const userFollowing = await UserFollowing.findBySrcDestIdAsync(sourceUser.document._id, targetUser.document._id, apiContext.db, apiContext.config);
	if (userFollowing == null) {
		throw new ApiError(404, 'not following', false);
	}

	apiContext.response(204);
};

exports.put = async (apiContext) => {
	await apiContext.check({
		body: {},
		permissions: ['userWrite']
	});

	apiContext.body = apiContext.body || {};

	// source user
	const sourceUser = await User.findByIdAsync(apiContext.params.id, apiContext.db, apiContext.config);
	if (sourceUser == null) {
		throw new ApiError(404, 'user as premise not found');
	}
	const sourceUserId = sourceUser.document._id;

	if (!sourceUserId.equals(apiContext.user.document._id)) {
		throw new ApiError(403, 'this operation is not permitted');
	}

	// target user
	const targetUser = await User.findByIdAsync(apiContext.params.target_id, apiContext.db, apiContext.config);
	if (targetUser == null) {
		throw new ApiError(404, 'target user as premise not found');
	}
	const targetUserId = targetUser.document._id;

	if (targetUserId.equals(sourceUserId)) {
		throw new ApiError(400, 'source user and target user is same');
	}

	// message
	const message = apiContext.body.message;
	if (message != null && (/^\s*$/.test(message) || /^[\s\S]{1,64}$/.test(message) == false)) {
		throw new ApiError(400, 'message is invalid format.');
	}

	// ドキュメント作成・更新
	let resultUpsert;
	try {
		resultUpsert = await apiContext.db.userFollowings.upsertAsync({ // TODO: move to document models
			source: sourceUserId,
			target: targetUserId
		}, {
			source: sourceUserId,
			target: targetUserId,
			message: message
		}, { renewal: true });
	}
	catch (err) {
		console.log(err);
	}

	if (resultUpsert.ok != 1) {
		throw new ApiError(500, 'failed to create or update userFollowing');
	}

	let userFollowing;
	try {
		userFollowing = await UserFollowing.findBySrcDestIdAsync(sourceUserId, targetUserId, apiContext.db, apiContext.config);
	}
	catch (err) {
		console.log(err);
	}

	if (userFollowing == null) {
		throw new ApiError(500, 'failed to fetch userFollowing');
	}

	// 対象ユーザーのストリームを購読
	const stream = apiContext.streams.get(StreamUtil.buildStreamId('user-timeline-status', sourceUserId.toString()));
	if (stream != null) {
		stream.addSource(targetUserId.toString()); // この操作は冪等
	}

	apiContext.response(204);
};

exports.delete = async (apiContext) => {
	await apiContext.check({
		query: {},
		permissions: ['userWrite']
	});

	// source user
	const soruceUser = await User.findByIdAsync(apiContext.params.id, apiContext.db, apiContext.config);
	if (soruceUser == null) {
		throw new ApiError(404, 'user as premise not found');
	}
	if (!soruceUser.document._id.equals(apiContext.user.document._id)) {
		throw new ApiError(403, 'this operation is not permitted');
	}

	// target user
	const targetUser = await User.findByIdAsync(apiContext.params.target_id, apiContext.db, apiContext.config);
	if (targetUser == null) {
		throw new ApiError(404, 'target user as premise not found');
	}

	const userFollowing = await UserFollowing.findBySrcDestIdAsync(soruceUser.document._id, targetUser.document._id, apiContext.db, apiContext.config);

	// ドキュメントが存在すれば削除
	if (userFollowing != null) {
		await userFollowing.removeAsync();

		// 対象ユーザーのストリームを購読解除
		const stream = apiContext.streams.get(StreamUtil.buildStreamId('user-timeline-status', soruceUser.document._id.toString()));
		if (stream != null) {
			stream.removeSource(targetUser.document._id.toString());
		}
	}

	apiContext.response(204);
};
