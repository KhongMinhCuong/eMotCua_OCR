export const config = {
  PORT: process.env.PORT || 3000,
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
  AI_SERVER_URL: process.env.AI_SERVER_URL || 'http://localhost:8080',
  ALLOWED_EXTENSIONS: ['.pdf', '.png', '.jpg', '.jpeg', '.bmp', '.tiff'],
};