import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { return next(specifier === 'npm:zod@4.4.3' ? 'zod' : specifier === 'npm:nodemailer@10.3.1' ? 'nodemailer' : specifier, context); } });
