import { Router } from "express";
import { postTransfer } from "./transfer.controller.js";

export const transferRouter = Router();

transferRouter.post("/", postTransfer);
