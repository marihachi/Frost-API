<?php
namespace Models;

class Application
{
	// 権限一覧
	public static $permissionTypes = [
		'internal',			// 内部APIへのアクセス
		'account-read',		// アカウント情報の取得
		'account-write',	// アカウント情報の変更
		'user-read',		// ユーザー情報の取得
		'user-write',		// フォローやブロック等のアクション
		'post-read',		// 投稿の取得
		'post-write',		// 投稿の作成・削除、投稿へのアクション
	];

	public static function create($userId, $name, $description, array $permissions, $container)
	{
		$config = $container->config;
		$db = $container->dbManager;

		$now = time();

		$isPermissionError = false;
		$invalidPermissionNames = [];
		$permissions2 = [];
		foreach ($permissions as $permission)
		{
			$isFound = false;
			for ($i=0; $i < count($permissionTypes); $i++)
			{
				if($permission === $permissionTypes[$i])
				{
					$isFound = true;
					if (in_array($permission, $permissions2))
						throw new ApiException('permissions is duplicate');

					$permissions2 += $permission;
					break;
				}
			}

			if (!$isFound)
			{
				$isPermissionError = true;
				$invalidPermissionNames += $permission;
			}
		}

		if ($isPermissionError)
			throw new ApiException('unknown permissions', $invalidPermissionNames);

		try
		{
			$application = self::fetchByName($name);
		}
		catch(ApiException $e)
		{
		}

		if (isset($application))
			throw new ApiException('already exists.');

		try
		{
			$application = $db->transaction(function() use($db, $userId, $now, $name, $description, $permissions, $config) {
				$applicationTable = $config['db']['table-names']['application'];
				$db->executeQuery("insert into $applicationTable (creator_id, created_at, name, description, permissions) values(?, ?, ?, ?)", [$userId, $now, $name, $description, implode(',', $permissions)]);
				return $db->executeQuery("select * from $applicationTable where creator_id = ? & name = ?", [$userId, $name])->fetch()[0];
			});
		}
		catch(Exception $e)
		{
			throw new ApiException('faild to create database record');
		}

		$key = self::generateKey($application['id'], $userId, $config, $db);

		$application['key'] = $key;

		return $application;
	}

	public static function generateKey($applicationId, $userId, $container)
	{
		$config = $container->config;
		$db = $container->dbManager;

		$application = self::fetch($applicationId, $db);

		$num = rand(1, 99999);
		$hash = hash('sha256', $config['application-key-base'].$userId.$applicationId.$num);

		try
		{
			$applicationTable = $config['db']['table-names']['application'];
			$container->dbManager->executeQuery("update $applicationTable set hash = ? where id = ?", [$hash, $applicationId]);
		}
		catch(PDOException $e)
		{
			throw new ApiException('faild to create database record', ['application-key']);
		}

		return $applicationId.'-'.$hash;
	}

	public static function fetch($id, $container)
	{
		$config = $container->config;
		$db = $container->dbManager;

		try
		{
			$applicationTable = $config['db']['table-names']['application'];
			$apps = $db->executeQuery("select * from $applicationTable where id = ?", [$id])->fetch();
		}
		catch(PDOException $e)
		{
			throw new ApiException('faild to fetch application');
		}

		if (count($apps) === 0)
			throw new ApiException('application not found');

		return $apps[0];
	}

	public static function fetchByName($name, $container)
	{
		$config = $container->config;
		$db = $container->dbManager;

		try
		{
			$applicationTable = $config['db']['table-names']['application'];
			$apps = $db->executeQuery("select * from $applicationTable where name = ?", [$name])->fetch();
		}
		catch(PDOException $e)
		{
			throw new ApiException('faild to fetch application');
		}

		if (count($apps) === 0)
			throw new ApiException('application not found');

		return $apps[0];
	}

	public static function buildKey($id, $hash)
	{
		return $id.'-'.$hash;
	}

	public static function validate($applicationKey, $container)
	{
		$config = $container->config;
		$db = $container->dbManager;

		$match = \Utility\Regex::match('/([^-]+)-([^-]{64})/', $applicationKey);

		if ($match === null)
			return false;

		$applicationId = $match[1];
		$hash = $match[2];

		try
		{
			$application = self::fetch($applicationId, $db);
		}
		catch (ApiException $e)
		{
			return false;
		}

		return $hash === $application['hash'];
	}
}
