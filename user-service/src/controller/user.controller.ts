import { Request, Response } from "express";
import logger from "../utils/logger";
import User from "../models/user.model";
import redisClient from "../config/redis";
import { queue } from "../utils/imageWorker";
import { connection } from "../config/dbConnect";
import mongoose from "mongoose";
import { invalidatePermissions } from "../utils/fetchPermissions";
import { publishEvent } from "../config/rabbitMq";

export const getUser = async (req: Request, res: Response) => {
  logger.info("get user endpoint hit");
  try {
    const username = req.params.username;
    if (req.body.length > 0) {
      res.status(400).json({ success: false, message: "body not allowed" });
    }
    const expiryTime = 5 * 60;
    if (!username) {
      res.status(400).json({ success: false, message: "Username required" });
      return;
    }

    const cachedResult = await redisClient.get(`search:${username}`);

    if (cachedResult) {
      res
        .status(200)
        .json({ success: true, cachedResult: JSON.parse(cachedResult) });
      return;
    }

    const results = await User.find(
      { $text: { $search: username } },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(10)
      .lean()
      .select("-email");

    res.status(200).json({ success: true, results });
    await redisClient.set(
      `search:${username}`,
      JSON.stringify(results),
      "EX",
      expiryTime
    );
    return;
  } catch (error) {
    logger.error("An error occured in the getUser controller", error);
    res.status(500).json({ message: error });
  }
};

export const getCurrentUser = async (req: Request, res: Response) => {
  logger.info("Get current user endpoint hit");
  try {
    const userId = req.userId;

    console.log("USERID", userId);

    const cachedUser = await redisClient.get(`user:${userId}`);

    if (cachedUser) {
      res
        .status(200)
        .json({ success: false, currentUser: JSON.parse(cachedUser) });
      return;
    }

    const currentUser = await User.findById(userId);

    if (!currentUser) {
      res.status(404).json({ success: false, message: "user not found" });
      return;
    }

    await redisClient.set(`user:${userId}`, JSON.stringify(currentUser));

    res.status(200).json({ success: true, currentUser });
    return;
  } catch (error) {
    logger.error("An error occured in the getCurrentUser controller", error);
    res.status(500).json({ message: error });
  }
};

export const updateUserInfo = async (req: Request, res: Response) => {
  try {
    const { username, bio, avatar } = req.body;
    const userId = req.userId;
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      res.status(404).json({ success: false, message: "user not found" });
      return;
    }

    if (avatar) {
      queue.add(
        "upload-avatar",
        { imagePath: avatar, userId },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    }

    currentUser.username = username || currentUser.username;
    currentUser.bio = bio || currentUser.bio;

    await currentUser.save();

    res
      .status(201)
      .json({ success: false, message: "Profile updated successfully" });
    return;
  } catch (error) {
    logger.error("An error occured in the getCurrentUser controller", error);
    res.status(500).json({ message: error });
  }
};

let session: mongoose.mongo.ClientSession | undefined;

export const removeFriend = async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const { friendId } = req.body;

    session = await connection?.startSession();

    if (userId === friendId) {
      res
        .status(400)
        .json({ success: false, message: "Cannot unfriend yourself" });
      return;
    }

    const transaction = await session?.withTransaction(async () => {
      await User.findByIdAndUpdate(
        userId,
        {
          $pull: { friends: friendId },
        },
        { session }
      );

      await User.findByIdAndUpdate(
        friendId,
        {
          $pull: { friends: userId },
        },
        { session }
      );
    });

    logger.info("TRANSACTION COMPLETE");
    await invalidatePermissions(userId);
    await invalidatePermissions(friendId);

    publishEvent("chat.deleted", {
      user1: userId,
      user2: friendId,
    });

    res
      .status(200)
      .json({ success: true, message: "friend removed sucessfully" });
    return;
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    await session?.endSession();
  }
};
