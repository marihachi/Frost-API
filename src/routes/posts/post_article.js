const ApiContext = require('../../modules/ApiContext');
const { getStringSize } = require('../../modules/helpers/GeneralHelper');
const $ = require('cafy').default;

/** @param {ApiContext} apiContext */
exports.post = async (apiContext) => {
	await apiContext.proceed({
		body: {
			title: { cafy: $().string() },
			text: { cafy: $().string() }
		},
		scopes: ['post.write']
	});
	if (apiContext.responsed) return;

	const { title, text } = apiContext.body;

	if (/^\s*$/.test(title) || getStringSize(text) > 64) {
		apiContext.response(400, 'title is invalid format. max 64bytes');
		return;
	}

	if (/^\s*$/.test(text) || getStringSize(text) > 10000) {
		apiContext.response(400, 'text is invalid format. max 10,000bytes');
		return;
	}

	const postArticle = await apiContext.postsService.createArticlePost(apiContext.user._id, text, title);
	if (postArticle == null) {
		apiContext.response(500, 'failed to create postArticle');
		return;
	}

	apiContext.response(200, { postArticle: await apiContext.postsService.serialize(postArticle, true) });
};
