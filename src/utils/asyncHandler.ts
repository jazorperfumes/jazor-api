import type { Request, Response, NextFunction, RequestHandler } from "express";

export const asyncHandler =
  <P = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
    fn: (
      req: Request<P, ResBody, ReqBody, ReqQuery>,
      res: Response<ResBody>,
      next: NextFunction,
    ) => Promise<unknown>,
  ): RequestHandler<P, ResBody, ReqBody, ReqQuery> =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
