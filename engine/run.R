library(plumber)
pr <- plumber::plumb("plumber.R")
pr$setDebug(TRUE)
pr$run(host = "127.0.0.1", port = 8000)
