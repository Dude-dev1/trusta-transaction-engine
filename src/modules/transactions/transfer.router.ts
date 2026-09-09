import { Router } from "express";
import { postTransfer } from "./transfer.controller.js";
import { asyncHandler } from "../../utils/async-handler.js";

export const transferRouter = Router();

transferRouter.post("/", asyncHandler(postTransfer));
