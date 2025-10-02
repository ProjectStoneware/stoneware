library(plumber)
library(broom)

# In-memory dataset store
STONEWARE_DATA <- new.env(parent = emptyenv())

# CORS
#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")
  res$setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  if (req$REQUEST_METHOD == "OPTIONS") { res$status <- 204; return(list()) }
  forward()
}

#* @get /health
function() list(status="ok", engine="plumber", language="R")

#* @get /hello
function(name="Stoneware") list(message=paste("Hello from R,", name, "👋"))

#* Upload CSV and store by name
#* @param name:char
#* @param file:file
#* @post /data/upload
function(name="my_data", file) {
  if (missing(file) || is.null(file$datapath)) stop("No file uploaded.")
  df <- tryCatch(utils::read.csv(file$datapath, stringsAsFactors=FALSE, check.names=FALSE),
                 error=function(e) stop(paste("Failed to read CSV:", e$message)))
  assign(name, df, envir=STONEWARE_DATA)
  list(name=name, rows=nrow(df), cols=ncol(df), columns=unname(colnames(df)))
}

#* Linear regression on built-in or uploaded data
#* Example: /analyze/linear?data=mtcars&formula=mpg~wt
#* @get /analyze/linear
function(data="mtcars", formula="mpg~wt", alpha=0.05) {
  df <- if (exists(data, envir=STONEWARE_DATA, inherits=FALSE)) {
    get(data, envir=STONEWARE_DATA, inherits=FALSE)
  } else {
    switch(data, "mtcars"=mtcars, stop("Dataset not found. Upload with /data/upload or use data=mtcars"))
  }
  fit <- lm(as.formula(formula), data=df)
  summ <- broom::tidy(fit, conf.int=TRUE, conf.level=1 - as.numeric(alpha))
  gl   <- broom::glance(fit)
  list(
    r_code = sprintf("fit <- lm(%s, data = %s)", formula, data),
    model_summary = list(
      n = nrow(model.frame(fit)),
      r2 = unname(gl$r.squared),
      adj_r2 = unname(gl$adj.r.squared),
      sigma = unname(gl$sigma),
      f_stat = list(value=unname(gl$statistic), df1=unname(gl$df), df2=unname(gl$df.residual), p=unname(gl$p.value)),
      coefficients = lapply(seq_len(nrow(summ)), function(i) list(
        term = summ$term[i], estimate = unname(summ$estimate[i]), se = unname(summ$std.error[i]),
        t = unname(summ$statistic[i]), p = unname(summ$p.value[i]),
        ci = c(unname(summ$conf.low[i]), unname(summ$conf.high[i]))
      ))
    )
  )
}
# --- begin patch: robust multipart upload ---

#* @post /data/upload
#* @parser multi
#* @param name The dataset name to store in memory
function(req, name = "my_data") {
  # Accepts multipart/form-data; looks in req$files
  if (is.null(req$files) || length(req$files) == 0) {
    stop("No file uploaded (multipart).")
  }

  # Prefer the field named "file", otherwise take the first file part
  filepart <- req$files[["file"]]
  if (is.null(filepart)) filepart <- req$files[[1]]

  if (is.null(filepart$datapath) || !file.exists(filepart$datapath)) {
    stop("Uploaded file part missing datapath.")
  }

  df <- tryCatch(
    utils::read.csv(filepart$datapath, stringsAsFactors = FALSE, check.names = FALSE),
    error = function(e) stop(paste("Failed to read CSV:", e$message))
  )

  assign(name, df, envir = STONEWARE_DATA)
  list(name = name, rows = nrow(df), cols = ncol(df), columns = unname(colnames(df)))
}

# --- end patch ---
