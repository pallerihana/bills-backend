# 🚀 CodeTantra Expense Management System – Backend

A secure and scalable backend API for managing **project-related expenses, employee bill submissions, company bills, proof documents, and reimbursement reports**.

This backend powers the CodeTantra Expense Management System and provides REST APIs for administrators and employees.

---

## ✨ Features

### 🔐 Authentication & Security
- Secure login with JWT authentication
- Password hashing using bcrypt
- Protected API routes
- Environment-based configuration

### 📁 Project Management
- Create and manage project details
- Configure project start and end dates
- Set expense submission deadlines
- Manage project employees

### 🧾 Employee Expense Bills
- Submit project-related expenses
- Add expense date, reason, members, paid-by details, and amount
- Upload multiple proof files for a single bill
- View previously submitted bills
- Automatic bill numbering

### 🏢 Company Bills
- Separate company bill management
- Dedicated bill numbering (`C-1`, `C-2`, etc.)
- Separate employee expense and company bill totals
- Grand total calculation

### ☁️ Cloud Proof Storage
- Secure proof file storage using Cloudinary
- Separate storage for employee and company proofs
- Support for images and PDF documents
- Automatic cleanup of temporary proof files after the configured deadline
- Final proof document is preserved before cleanup

### 📊 Reports & Documents
- Export expense data to Excel
- Employee-wise reimbursement summaries
- Generate consolidated proof documents
- Preserve bill information after proof cleanup

### 📧 Employee Notifications
- Send expense submission forms to employees
- Personalized project details and submission deadlines
- YES/NO response links
- Reminder email support

### 🕒 Automated Cleanup
- Scheduled cleanup using `node-cron`
- Automatically checks for projects eligible for proof cleanup
- Prevents overlapping cleanup jobs
- Safely preserves final documents and expense data

---

## 🛠️ Tech Stack

- **Node.js**
- **Express.js**
- **MongoDB**
- **Mongoose**
- **JWT Authentication**
- **Cloudinary**
- **EmailJS**
- **ExcelJS**
- **PDF-Lib**
- **Node Cron**

---

## 📁 Project Structure

```text
bills-backend/
│
├── config/          # Database and Cloudinary configuration
├── middleware/      # Authentication and other middleware
├── models/          # MongoDB models
├── routes/          # API routes
├── services/        # Business logic and external services
├── utils/           # Helper utilities
│
├── server.js        # Application entry point
├── seed.js          # Initial user data seeding
├── package.json
└── README.md
```

---

## ⚙️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/pallerihana/bills-backend.git
cd bills-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret

PORT=5000
CLIENT_URL=http://localhost:5173
APP_TZ_OFFSET_MIN=330

EMAILJS_SERVICE_ID=your_service_id
EMAILJS_TEMPLATE_ID=your_template_id
EMAILJS_PUBLIC_KEY=your_public_key
EMAILJS_PRIVATE_KEY=your_private_key
EMAILJS_RECEIPT_TEMPLATE_ID=your_receipt_template_id

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

> ⚠️ Never commit your `.env` file or expose API keys and secrets publicly.

---

## ▶️ Running the Application

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

The API will run on:

```text
http://localhost:5000
```

---

## 🌐 Deployment

The backend is designed to be deployed as a Node.js web service.

### Production Environment

Set the required environment variables in your hosting platform.

```text
Frontend → Netlify
Backend  → Render
Database → MongoDB Atlas
Storage  → Cloudinary
```

---

## 🔌 API Base URL

### Local Development

```text
http://localhost:5000/api
```

### Production

```text
https://your-render-service-url/api
```

---

## 🔒 Security

- Environment variables are used for sensitive credentials.
- Passwords are securely hashed.
- Protected routes use JWT authentication.
- Cloudinary API secrets remain on the backend.
- Sensitive files such as `.env` are excluded through `.gitignore`.

---

## 👨‍💻 Author

**Palle Anil**

Technical Trainer | Full Stack Developer

---

⭐ If you find this project useful, feel free to star the repository!
