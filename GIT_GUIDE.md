# Git Guide for Retro Crypto Alchemist

## Quick Git Commands You'll Need

### 1. Check Status
```bash
git status
```
Shows what files have been changed, added, or deleted.

### 2. See Your Commit History
```bash
git log --oneline
```
Shows all your previous commits in a simple list.

### 3. Save Changes (Create a Commit)
```bash
# Add all changed files
git add .

# Commit with a message describing what you changed
git commit -m "Your description of changes here"
```

### 4. Revert to a Previous Version
```bash
# First, see your commit history
git log --oneline

# Then revert to a specific commit (replace COMMIT-ID with actual ID)
git checkout COMMIT-ID

# To go back to the latest version
git checkout master
```

## Current Status
✅ Git is now enabled for your project
✅ Your first commit has been created
✅ All files are being tracked (except those in .gitignore)

## Example Workflow

### Making Changes and Saving Them:
1. Make changes to your files
2. Run: `git add .`
3. Run: `git commit -m "Fixed parallel processing bug"`

### Going Back to an Old Version:
1. Run: `git log --oneline` to see all versions
2. Find the commit ID you want to go back to
3. Run: `git checkout COMMIT-ID`
4. To return to latest: `git checkout master`

## Your Current Commits:
- `3926a67` - Implement automated scheduler system with job management and position tracking
- `8911b30` - Implement multi-profile discovery system with fresh data optimization
- `059e9f5` - Update Git guide with new scan profiles commit
- `7b38d06` - Add 6 new scan profiles for rare earning opportunities
- `faa1ba3` - Add Git usage guide for easy reference  
- `e48b6a7` - Initial commit: Retro Crypto Alchemist V7 with parallel analysis and clean logging

## Important Notes:
- Always commit your changes before trying to revert
- Each commit creates a "save point" you can return to
- The .env.local file is ignored (won't be committed for security)
- node_modules and other build files are automatically ignored
