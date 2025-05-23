import Joi from "joi";
import { AuthUser } from "../types/types";

export const registrationSchema = Joi.object({
  username: Joi.string().min(6).max(30).required(),
  email: Joi.string().email().required().max(300),
  password: Joi.string().min(6).required(),
  bio: Joi.string(), 
  avatar: Joi.string().base64(),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const otpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().min(6).required(),
});
export const validateRegistration = (data: AuthUser) => {
  return registrationSchema.validate(data);
};

export const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().min(6).required(),
});
