# Cloud-Mobile-App-Analysis

Cloud-Based Mobile App Security Analysis

## Project Overview
This project provides a cloud-based platform for app security testing. It includes dynamic and static analysis APIs, a frontend for user interaction, and a backend server for managing requests and processing results. The platform is designed to help developers and security researchers identify vulnerabilities in mobile applications.

## Setup Instructions
1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```bash
   cd app-security-testing
   ```
3. Build and start the Docker containers:
   ```bash
   sudo docker compose up -d --build
   ```
4. Deploy the required environment files (`.env`, `serviceAccountKey.json`) in the appropriate directories.

## Usage Instructions
- Access the frontend at `http://localhost:5173`.
- Use the dynamic API for runtime analysis of Android apps.
- Use the static API for analyzing APK files without execution.
- Refer to the `frontend/src/components` directory for UI components and their functionalities.

## Dependencies
- **Docker**: Containerization platform for running the application.
- **Node.js**: Used for the frontend development.
- **Python**: Backend APIs for dynamic and static analysis.
- **Androguard**: Static analysis of Android applications.
- **Firebase**: Authentication and database services.

## Folder Structure
- `android_dynamic_api/`: Contains the dynamic analysis API.
- `android_static_api/`: Contains the static analysis API.
- `frontend/`: React-based frontend application.
- `server/`: Backend server for managing requests and processing results.